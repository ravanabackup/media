import { adjacentMedia, getMedia, MEDIA, type MediaItem } from "@/lib/media";
import type { DeviceInfo, DeviceKind, PlaybackState, PlaybackStatus, Snapshot, UpdateResponse } from "@/lib/types";

/** How often the playing device reports its position. */
const HEARTBEAT_MS = 2_000;
/** If the live stream is silent this long, fall back to polling. */
const STREAM_SILENCE_MS = 5_000;
const POLL_MS = 1_000;
/** No word from the server at all for this long means we are offline. */
const OFFLINE_AFTER_MS = 7_000;
/** A "playing" report older than this means the source device went away. */
export const STALE_AFTER_MS = 12_000;

const DEVICE_KEY = "relay.device-id";
const MEDIA_EVENTS = [
  "play",
  "playing",
  "waiting",
  "pause",
  "seeked",
  "ratechange",
  "loadedmetadata",
  "durationchange",
  "timeupdate",
  "ended",
  "error",
] as const;

export interface LocalPlayer {
  mediaId: string | null;
  paused: boolean;
  waiting: boolean;
  time: number;
  duration: number;
  error: string | null;
}

export interface RelayView {
  /** At least one live snapshot has arrived since the page opened. */
  synced: boolean;
  connected: boolean;
  device: DeviceInfo | null;
  devices: DeviceInfo[];
  remote: PlaybackState | null;
  /** Best estimate of the server clock, ms. Ticks while something is playing. */
  serverNow: number;
  /** This device is (or is becoming) the playback source. */
  own: boolean;
  local: LocalPlayer;
}

const IDLE_LOCAL: LocalPlayer = { mediaId: null, paused: true, waiting: false, time: 0, duration: 0, error: null };

/** Where the remote playhead is right now, extrapolated from its last report. */
export function remoteLive(remote: PlaybackState, serverNow: number) {
  const age = Math.max(0, serverNow - remote.updatedAt);
  const stale = remote.status !== "paused" && age > STALE_AFTER_MS;
  let position = remote.position;
  if (remote.status === "playing" && !stale) position += (age / 1000) * remote.rate;
  if (remote.duration > 0) position = Math.min(position, remote.duration);
  return { position, stale, age };
}

function detectDevice(): DeviceInfo {
  let id: string | null = null;
  try {
    id = window.sessionStorage.getItem(DEVICE_KEY);
  } catch {
    // Storage can be blocked; a per-page id still works.
  }
  if (!id || !/^[A-Za-z0-9_-]{6,64}$/.test(id)) {
    id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `d-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    try {
      window.sessionStorage.setItem(DEVICE_KEY, id);
    } catch {
      // See above.
    }
  }

  const ua = navigator.userAgent;
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  let name = "Computer";
  let kind: DeviceKind = "desktop";

  if (/iPhone|iPod/.test(ua)) {
    name = "iPhone";
    kind = "mobile";
  } else if (/iPad/.test(ua) || touchMac) {
    name = "iPad";
    kind = "tablet";
  } else if (/Android/.test(ua)) {
    const phone = /Mobile/.test(ua);
    name = phone ? "Android phone" : "Android tablet";
    kind = phone ? "mobile" : "tablet";
  } else if (/Windows/.test(ua)) {
    name = "Windows PC";
  } else if (/Macintosh|Mac OS X/.test(ua)) {
    name = "Mac";
  } else if (/CrOS/.test(ua)) {
    name = "Chromebook";
  } else if (/Linux/.test(ua)) {
    name = "Linux PC";
  }

  let browser = "";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Firefox|FxiOS/.test(ua)) browser = "Firefox";
  else if (/Chrome|CriOS/.test(ua)) browser = "Chrome";
  else if (/Safari/.test(ua)) browser = "Safari";

  return { id, name: browser ? `${name} · ${browser}` : name, kind };
}

function sameDevices(a: DeviceInfo[], b: DeviceInfo[]) {
  return a.length === b.length && a.every((d, i) => d.id === b[i].id && d.name === b[i].name && d.kind === b[i].kind);
}

interface PlayOptions {
  /** Start position in seconds. */
  at?: number;
  /** Take over as the source even if another device currently is. */
  claim?: boolean;
  autoplay?: boolean;
}

/**
 * Drives the local <video> element, reports what it is doing to the server,
 * and mirrors what other devices report. Framework-agnostic: React reads it
 * through `subscribe` / `getView`.
 */
export class RelayEngine {
  private view: RelayView;
  private readonly initialView: RelayView;
  private listeners = new Set<() => void>();

  private el: HTMLVideoElement | null = null;
  private es: EventSource | null = null;
  private started = false;
  private tickTimer = 0;
  private retryTimer = 0;
  private reconnectTimer = 0;

  private offset = 0;
  private lastMessage = 0;
  private lastStream = 0;
  private lastPoll = 0;
  private lastBeat = 0;
  private polling = false;

  private localMedia: string | null = null;
  private pendingSeek: number | null = null;
  private waiting = false;
  private error: string | null = null;

  /** A takeover has been requested and not yet confirmed by the server. */
  private claim = false;
  private inflight = false;
  private dirty = false;
  private resumeChecked = false;

  constructor(
    private readonly room: string,
    initial: Snapshot,
  ) {
    this.view = this.initialView = {
      synced: false,
      connected: false,
      device: null,
      devices: initial.devices,
      remote: initial.state,
      serverNow: initial.serverNow,
      own: false,
      local: IDLE_LOCAL,
    };
  }

  /* ---------- store ---------- */

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getView = () => this.view;
  getInitialView = () => this.initialView;

  private set(patch: Partial<RelayView>) {
    this.view = { ...this.view, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  /* ---------- lifecycle ---------- */

  start() {
    if (this.started) return;
    this.started = true;
    const now = Date.now();
    // Give the stream a moment before the polling fallback kicks in.
    this.lastStream = now - STREAM_SILENCE_MS + 2_500;
    this.lastMessage = now;
    this.offset = this.view.serverNow - now;

    this.set({ device: this.view.device ?? detectDevice() });
    this.connect();
    this.tickTimer = window.setInterval(this.tick, 250);
    window.addEventListener("pagehide", this.onPageHide);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.bindMediaSession();
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    this.onPageHide();
    window.clearInterval(this.tickTimer);
    window.clearTimeout(this.retryTimer);
    window.clearTimeout(this.reconnectTimer);
    window.removeEventListener("pagehide", this.onPageHide);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.es?.close();
    this.es = null;
  }

  /** Ref callback for the <video> element. */
  attach = (el: HTMLVideoElement | null) => {
    if (this.el === el) return;
    if (this.el) for (const type of MEDIA_EVENTS) this.el.removeEventListener(type, this.onMediaEvent);
    this.el = el;
    if (el) for (const type of MEDIA_EVENTS) el.addEventListener(type, this.onMediaEvent);
  };

  /* ---------- transport ---------- */

  private query() {
    const device = this.view.device;
    const params = new URLSearchParams({ room: this.room });
    if (device) {
      params.set("deviceId", device.id);
      params.set("name", device.name);
      params.set("kind", device.kind);
    }
    return params.toString();
  }

  private connect() {
    this.es?.close();
    const es = new EventSource(`/api/stream?${this.query()}`);
    es.onmessage = (event) => {
      try {
        this.ingest(JSON.parse(event.data) as Snapshot, true);
      } catch {
        // Ignore a malformed frame; the next one is seconds away.
      }
    };
    es.onerror = () => {
      // The browser retries by itself unless the connection was closed for good.
      if (es.readyState !== EventSource.CLOSED || this.es !== es) return;
      this.es = null;
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = window.setTimeout(() => {
        if (this.started && !this.es) this.connect();
      }, 2_000);
    };
    this.es = es;
  }

  private poll() {
    this.lastPoll = Date.now();
    if (this.polling) return;
    this.polling = true;
    fetch(`/api/state?${this.query()}`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<Snapshot>) : null))
      .then((snapshot) => {
        if (snapshot) this.ingest(snapshot, false);
      })
      .catch(() => {
        // Offline; the tick loop keeps trying.
      })
      .finally(() => {
        this.polling = false;
      });
  }

  private ingest(snapshot: Snapshot, fromStream: boolean) {
    const now = Date.now();
    this.lastMessage = now;
    if (fromStream) this.lastStream = now;
    this.offset = snapshot.serverNow - now;

    const patch: Partial<RelayView> = { synced: true, connected: true, serverNow: snapshot.serverNow };
    if (!sameDevices(this.view.devices, snapshot.devices)) patch.devices = snapshot.devices;

    let displaced = false;
    const next = snapshot.state;
    const prev = this.view.remote;
    if (next && (!prev || next.updatedAt > prev.updatedAt)) {
      const mine = next.deviceId === this.view.device?.id;
      // While our own takeover is in flight, reports from the previous source are already outdated.
      if (mine || !this.claim) {
        patch.remote = next;
        if (!mine && this.view.own) {
          patch.own = false;
          displaced = true;
        }
      }
    }

    patch.local = this.readLocal();
    this.set(patch);
    if (displaced) this.el?.pause();
    this.maybeResume();
  }

  /** Send the local player's current state to the server (coalesced: one request in flight at a time). */
  private sync = () => {
    if (!this.view.own) return;
    const el = this.el;
    const device = this.view.device;
    const mediaId = this.localMedia;
    if (!el || !device || !mediaId) return;
    if (this.inflight) {
      this.dirty = true;
      return;
    }

    window.clearTimeout(this.retryTimer);
    const claim = this.claim;
    this.inflight = true;
    this.dirty = false;
    this.lastBeat = Date.now();

    const retry = () => {
      this.inflight = false;
      this.retryTimer = window.setTimeout(this.sync, 1_500);
    };

    fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.report(device, mediaId, claim)),
      keepalive: true,
    })
      .then(async (res) => {
        if (res.status >= 500) return retry();
        this.inflight = false;
        if (!res.ok) return;
        const result = (await res.json()) as UpdateResponse;
        if (result.accepted) {
          if (claim) this.claim = false;
        } else if (!this.claim) {
          // Another device is the source now; step back.
          this.set({ own: false });
          this.el?.pause();
        }
        this.ingest(result, false);
        if (this.dirty) this.sync();
      })
      .catch(retry);
  };

  private report(device: DeviceInfo, mediaId: string, claim: boolean, forceStatus?: PlaybackStatus) {
    const local = this.readLocal();
    const status: PlaybackStatus = forceStatus ?? (local.paused ? "paused" : local.waiting ? "buffering" : "playing");
    return {
      room: this.room,
      deviceId: device.id,
      deviceName: device.name,
      deviceKind: device.kind,
      mediaId,
      status,
      position: local.time,
      duration: local.duration,
      rate: this.el?.playbackRate || 1,
      claim,
    };
  }

  /* ---------- local player ---------- */

  private readLocal(): LocalPlayer {
    const el = this.el;
    if (!el || !this.localMedia) return IDLE_LOCAL;
    const paused = el.paused || el.ended || this.error !== null;
    return {
      mediaId: this.localMedia,
      paused,
      waiting: !paused && (this.waiting || el.readyState < 3),
      time: this.pendingSeek ?? el.currentTime,
      duration: Number.isFinite(el.duration) ? el.duration : 0,
      error: this.error,
    };
  }

  private onMediaEvent = (event: Event) => {
    const el = this.el;
    if (!el || !this.localMedia) return;

    switch (event.type) {
      case "play":
        this.waiting = true;
        this.error = null;
        break;
      case "playing":
        this.waiting = false;
        break;
      case "waiting":
        this.waiting = true;
        break;
      case "loadedmetadata":
        if (this.pendingSeek !== null) {
          const max = Number.isFinite(el.duration) ? Math.max(0, el.duration - 0.25) : this.pendingSeek;
          el.currentTime = Math.min(this.pendingSeek, max);
          this.pendingSeek = null;
        }
        break;
      case "timeupdate":
        this.set({ local: this.readLocal() });
        if (!el.paused && Date.now() - this.lastBeat >= HEARTBEAT_MS) this.sync();
        return;
      case "ended":
        if (this.view.own) {
          // Routine advance by the current source, not a takeover.
          this.play(adjacentMedia(this.localMedia, 1).id, { claim: false });
          return;
        }
        break;
      case "error":
        this.waiting = false;
        this.error = "This media couldn't be loaded. Check your connection or try another item.";
        break;
    }

    this.set({ local: this.readLocal() });
    this.sync();
  };

  private handlePlayFailure = (error: unknown) => {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "AbortError") return; // Superseded by a newer load.
    this.waiting = false;
    this.error =
      name === "NotAllowedError"
        ? "Your browser blocked playback. Press play to start it on this device."
        : "This media couldn't be played. Try another item.";
    this.set({ local: this.readLocal() });
    this.sync();
  };

  /* ---------- actions ---------- */

  /** Play an item on this device. By default this takes over as the source. */
  play = (mediaId: string, { at = 0, claim = true, autoplay = true }: PlayOptions = {}) => {
    const el = this.el;
    const media = getMedia(mediaId);
    if (!el || !media) return;

    this.localMedia = media.id;
    this.pendingSeek = at > 0 ? at : null;
    this.error = null;
    this.waiting = autoplay;
    if (claim) this.claim = true;

    el.src = media.src;
    if (autoplay) el.play().catch(this.handlePlayFailure);

    this.updateMediaSession(media);
    this.set({ own: true, local: this.readLocal() });
    this.sync();
  };

  toggle = () => {
    const el = this.el;
    if (!el) return;

    if (!this.view.own || !this.localMedia) {
      if (this.view.remote && getMedia(this.view.remote.mediaId)) this.takeOver();
      else this.play(MEDIA[0].id);
      return;
    }
    if (this.error) {
      this.play(this.localMedia, { at: this.pendingSeek ?? el.currentTime });
      return;
    }
    if (el.paused) el.play().catch(this.handlePlayFailure);
    else el.pause();
  };

  /** Continue on this device what another device is playing, from its live position. */
  takeOver = () => {
    const remote = this.view.remote;
    if (!remote) return;
    const { position } = remoteLive(remote, Date.now() + this.offset);
    const nearEnd = remote.duration > 0 && remote.duration - position < 1.5;
    this.play(remote.mediaId, { at: nearEnd ? 0 : position });
  };

  seek = (seconds: number) => {
    const el = this.el;
    if (!el || !this.view.own || !this.localMedia || !Number.isFinite(seconds)) return;
    if (el.readyState >= 1) el.currentTime = Math.max(0, seconds);
    else this.pendingSeek = Math.max(0, seconds);
    this.set({ local: this.readLocal() });
  };

  next = () => {
    this.play(adjacentMedia(this.currentMediaId(), 1).id);
  };

  previous = () => {
    const el = this.el;
    if (this.view.own && el && el.currentTime > 3) {
      this.seek(0);
      return;
    }
    this.play(adjacentMedia(this.currentMediaId(), -1).id);
  };

  private currentMediaId() {
    return this.view.own ? this.localMedia : (this.view.remote?.mediaId ?? null);
  }

  /* ---------- housekeeping ---------- */

  /**
   * After a reload, the server may still list this tab as the source. Load the
   * item again (paused — browsers block autoplay) so the user can simply resume.
   */
  private maybeResume() {
    const device = this.view.device;
    if (this.resumeChecked || !device || !this.view.synced || !this.el) return;
    this.resumeChecked = true;
    const remote = this.view.remote;
    if (!remote || remote.deviceId !== device.id || this.view.own) return;
    const { position } = remoteLive(remote, this.view.serverNow);
    this.play(remote.mediaId, { at: position, claim: false, autoplay: false });
  }

  private tick = () => {
    const now = Date.now();
    if (now - this.lastStream > STREAM_SILENCE_MS && now - this.lastPoll > POLL_MS) this.poll();

    const connected = now - this.lastMessage < OFFLINE_AFTER_MS;
    const el = this.el;
    const remote = this.view.remote;
    // `timeupdate` drives the heartbeat while media advances; this covers stalls.
    if (this.view.own && el !== null && !el.paused && now - this.lastBeat >= HEARTBEAT_MS) this.sync();
    const active = (el !== null && !el.paused) || (remote !== null && remote.status !== "paused");
    if (active || connected !== this.view.connected) {
      this.set({ connected, serverNow: now + this.offset, local: this.readLocal() });
    }
  };

  private onPageHide = () => {
    const el = this.el;
    const device = this.view.device;
    if (!this.view.own || !el || el.paused || !device || !this.localMedia) return;
    // The page is going away mid-playback: tell everyone it stopped.
    try {
      const body = JSON.stringify(this.report(device, this.localMedia, false, "paused"));
      navigator.sendBeacon("/api/state", new Blob([body], { type: "application/json" }));
    } catch {
      // Other devices will notice the missing heartbeat instead.
    }
  };

  private onVisibility = () => {
    if (document.visibilityState !== "visible" || !this.started) return;
    if (!this.es || this.es.readyState === EventSource.CLOSED) this.connect();
    this.poll();
  };

  private updateMediaSession(media: MediaItem) {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: media.title,
      artist: media.artist,
      album: "Relay",
      artwork: [{ src: media.thumbnail, type: "image/jpeg" }],
    });
  }

  /** Lock-screen / notification / headset controls on the playing device. */
  private bindMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => this.el?.paused && this.toggle()],
      ["pause", () => this.el?.pause()],
      ["nexttrack", () => this.next()],
      ["previoustrack", () => this.previous()],
      ["seekto", (details) => typeof details.seekTime === "number" && this.seek(details.seekTime)],
    ];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Not every browser supports every action.
      }
    }
  }
}
