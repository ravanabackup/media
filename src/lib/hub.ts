import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { playbackState } from "@/db/schema";
import { getMedia } from "@/lib/media";
import type { DeviceInfo, DeviceKind, PlaybackState, PlaybackStatus, Snapshot } from "@/lib/types";

/**
 * Live hub. Keeps the current playback state of every channel in memory and
 * fans changes out to connected pages (SSE), while persisting to Postgres so
 * state survives restarts and is available to pages that open later.
 */

interface PresenceEntry extends DeviceInfo {
  conns: number;
  lastSeen: number;
}

interface Room {
  state: PlaybackState | null;
  loading: Promise<void> | null;
  listeners: Set<() => void>;
  presence: Map<string, PresenceEntry>;
}

const PRESENCE_TTL = 12_000;
const DISCONNECT_GRACE = 4_000;

const STATUSES: PlaybackStatus[] = ["playing", "paused", "buffering"];
const KINDS: DeviceKind[] = ["mobile", "tablet", "desktop"];

const store = globalThis as typeof globalThis & { __relayRooms?: Map<string, Room> };
const rooms: Map<string, Room> = (store.__relayRooms ??= new Map());

function getRoom(name: string): Room {
  let room = rooms.get(name);
  if (!room) {
    room = { state: null, loading: null, listeners: new Set(), presence: new Map() };
    rooms.set(name, room);
  }
  return room;
}

function notify(room: Room) {
  for (const listener of [...room.listeners]) {
    try {
      listener();
    } catch {
      // A broken listener must never take the others down.
    }
  }
}

function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function finite(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function parseDevice(input: { id?: unknown; name?: unknown; kind?: unknown }): DeviceInfo | null {
  if (typeof input.id !== "string" || !/^[A-Za-z0-9_-]{6,64}$/.test(input.id)) return null;
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 48) : "";
  return { id: input.id, name: name || "Unknown device", kind: oneOf(input.kind, KINDS, "desktop") };
}

export function ensureLoaded(name: string): Promise<void> {
  const room = getRoom(name);
  room.loading ??= (async () => {
    try {
      const [row] = await db.select().from(playbackState).where(eq(playbackState.room, name)).limit(1);
      if (row && !room.state) {
        room.state = {
          room: name,
          mediaId: row.mediaId,
          status: oneOf(row.status, STATUSES, "paused"),
          position: row.position,
          duration: row.duration,
          rate: row.rate,
          deviceId: row.deviceId,
          deviceName: row.deviceName,
          deviceKind: oneOf(row.deviceKind, KINDS, "desktop"),
          updatedAt: row.updatedAt.getTime(),
        };
      }
    } catch (error) {
      console.error("[relay] could not load persisted state:", error);
    }
  })();
  return room.loading;
}

async function persist(state: PlaybackState) {
  const values = {
    room: state.room,
    mediaId: state.mediaId,
    status: state.status,
    position: state.position,
    duration: state.duration,
    rate: state.rate,
    deviceId: state.deviceId,
    deviceName: state.deviceName,
    deviceKind: state.deviceKind,
    updatedAt: new Date(state.updatedAt),
  };
  const { room: _room, ...changes } = values;
  void _room;
  try {
    await db
      .insert(playbackState)
      .values(values)
      .onConflictDoUpdate({
        target: playbackState.room,
        set: changes,
        // Concurrent writes may land out of order; never let an older one win.
        setWhere: sql`${playbackState.updatedAt} < excluded.updated_at`,
      });
  } catch (error) {
    console.error("[relay] could not persist state:", error);
  }
}

function listDevices(room: Room): DeviceInfo[] {
  const now = Date.now();
  const devices: DeviceInfo[] = [];
  for (const [id, entry] of room.presence) {
    if (entry.conns > 0 || now - entry.lastSeen < PRESENCE_TTL) {
      devices.push({ id: entry.id, name: entry.name, kind: entry.kind });
    } else {
      room.presence.delete(id);
    }
  }
  return devices;
}

export function getSnapshot(name: string): Snapshot {
  const room = getRoom(name);
  return { state: room.state, devices: listDevices(room), serverNow: Date.now() };
}

export function subscribe(name: string, listener: () => void): () => void {
  const room = getRoom(name);
  room.listeners.add(listener);
  return () => {
    room.listeners.delete(listener);
  };
}

/** A page holds a live connection. Returns the function to call when it drops. */
export function joinPresence(name: string, device: DeviceInfo): () => void {
  const room = getRoom(name);
  const entry = room.presence.get(device.id) ?? { ...device, conns: 0, lastSeen: 0 };
  entry.name = device.name;
  entry.kind = device.kind;
  entry.conns += 1;
  entry.lastSeen = Date.now();
  room.presence.set(device.id, entry);
  notify(room);

  let left = false;
  return () => {
    if (left) return;
    left = true;
    entry.conns = Math.max(0, entry.conns - 1);
    // Keep the device listed briefly so a reload doesn't make it flicker.
    entry.lastSeen = Date.now() - (PRESENCE_TTL - DISCONNECT_GRACE);
  };
}

/** A page checked in without a live connection (polling fallback, or a state update). */
export function touchPresence(name: string, device: DeviceInfo) {
  const room = getRoom(name);
  const entry = room.presence.get(device.id);
  if (entry) {
    entry.name = device.name;
    entry.kind = device.kind;
    entry.lastSeen = Date.now();
    return;
  }
  room.presence.set(device.id, { ...device, conns: 0, lastSeen: Date.now() });
  notify(room);
}

export type UpdateResult = { ok: true; accepted: boolean } | { ok: false; error: string };

/**
 * Apply a playback report from a device.
 *
 * Only one device is the source at a time. Routine reports (heartbeats, pause,
 * seek) are accepted only from the current source; a device becomes the source
 * by sending `claim: true`, which it does when its user presses play.
 */
export async function applyUpdate(name: string, raw: unknown): Promise<UpdateResult> {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Body must be a JSON object." };
  const body = raw as Record<string, unknown>;

  const device = parseDevice({ id: body.deviceId, name: body.deviceName, kind: body.deviceKind });
  if (!device) return { ok: false, error: "A valid deviceId is required." };

  const media = getMedia(typeof body.mediaId === "string" ? body.mediaId : null);
  if (!media) return { ok: false, error: "Unknown mediaId." };

  if (!STATUSES.includes(body.status as PlaybackStatus)) return { ok: false, error: "Invalid status." };

  await ensureLoaded(name);
  const room = getRoom(name);
  touchPresence(name, device);

  const current = room.state;
  if (current && current.deviceId !== device.id && body.claim !== true) {
    return { ok: true, accepted: false };
  }

  const duration = finite(body.duration, 0, 172_800, 0);
  const next: PlaybackState = {
    room: name,
    mediaId: media.id,
    status: body.status as PlaybackStatus,
    position: finite(body.position, 0, duration > 0 ? duration : 172_800, 0),
    duration,
    rate: finite(body.rate, 0.25, 4, 1),
    deviceId: device.id,
    deviceName: device.name,
    deviceKind: device.kind,
    updatedAt: Math.max(Date.now(), (current?.updatedAt ?? 0) + 1),
  };

  room.state = next;
  notify(room);
  await persist(next);
  return { ok: true, accepted: true };
}
