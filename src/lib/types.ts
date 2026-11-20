export type PlaybackStatus = "playing" | "paused" | "buffering";
export type DeviceKind = "mobile" | "tablet" | "desktop";

export interface DeviceInfo {
  id: string;
  name: string;
  kind: DeviceKind;
}

export interface PlaybackState {
  room: string;
  mediaId: string;
  status: PlaybackStatus;
  /** Seconds into the media at the moment of `updatedAt`. */
  position: number;
  duration: number;
  rate: number;
  deviceId: string;
  deviceName: string;
  deviceKind: DeviceKind;
  /** Server clock, ms. Strictly increasing per room, so it doubles as a version. */
  updatedAt: number;
}

export interface Snapshot {
  state: PlaybackState | null;
  devices: DeviceInfo[];
  /** Server clock at the moment the snapshot was produced, ms. */
  serverNow: number;
}

export interface UpdateResponse extends Snapshot {
  accepted: boolean;
}

export const DEFAULT_ROOM = "main";

export function normalizeRoom(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_ROOM;
  const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
  return cleaned || DEFAULT_ROOM;
}
