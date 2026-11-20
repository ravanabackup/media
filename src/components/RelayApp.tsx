"use client";

/* eslint-disable @next/next/no-img-element -- artwork comes from arbitrary media hosts */

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ConnectDialog } from "@/components/ConnectDialog";
import {
  DeviceIcon,
  Equalizer,
  LogoMark,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  PreviousIcon,
} from "@/components/icons";
import { MEDIA, getMedia, type MediaItem } from "@/lib/media";
import { RelayEngine, remoteLive, type RelayView } from "@/lib/relay-engine";
import type { DeviceKind, Snapshot } from "@/lib/types";

type DisplayStatus = "idle" | "playing" | "paused" | "buffering" | "offline";

interface NowPlaying {
  /** `source`: this device is playing. `viewer`: mirroring another device. */
  mode: "idle" | "source" | "viewer";
  media: MediaItem | null;
  status: DisplayStatus;
  position: number;
  duration: number;
  source: { id: string; name: string; kind: DeviceKind } | null;
  /** Seconds since the source last reported (viewer only). */
  silentFor: number;
  error: string | null;
}

const IDLE: NowPlaying = {
  mode: "idle",
  media: null,
  status: "idle",
  position: 0,
  duration: 0,
  source: null,
  silentFor: 0,
  error: null,
};

function describe(view: RelayView): NowPlaying {
  const local = view.local;
  if (view.own && local.mediaId) {
    return {
      mode: "source",
      media: getMedia(local.mediaId) ?? null,
      status: local.paused ? "paused" : local.waiting ? "buffering" : "playing",
      position: local.time,
      duration: local.duration,
      source: null,
      silentFor: 0,
      error: local.error,
    };
  }

  const remote = view.remote;
  const media = getMedia(remote?.mediaId);
  if (remote && media) {
    const live = remoteLive(remote, view.serverNow);
    return {
      mode: "viewer",
      media,
      status: live.stale ? "offline" : remote.status,
      position: live.position,
      duration: remote.duration,
      source: { id: remote.deviceId, name: remote.deviceName, kind: remote.deviceKind },
      silentFor: Math.round(live.age / 1000),
      error: null,
    };
  }

  return IDLE;
}

function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function formatAgo(seconds: number) {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return "a while ago";
}

/** `precise` adds the ticking "how long ago" detail, which is left out of screen-reader announcements. */
function statusLine(now: NowPlaying, otherDevices: number, precise = true) {
  if (now.mode === "source") {
    const audience =
      otherDevices > 0 ? ` · showing live on ${otherDevices} other ${otherDevices === 1 ? "device" : "devices"}` : "";
    if (now.status === "paused") return `Paused on this device${audience}`;
    if (now.status === "buffering") return `Loading on this device${audience}`;
    return `Playing on this device${audience}`;
  }
  if (now.mode === "viewer" && now.source) {
    if (now.status === "offline") {
      return precise ? `${now.source.name} stopped reporting ${formatAgo(now.silentFor)}` : `${now.source.name} stopped reporting`;
    }
    if (now.status === "paused") return `Paused on ${now.source.name}`;
    if (now.status === "buffering") return `Loading on ${now.source.name}`;
    return `Playing on ${now.source.name}`;
  }
  return "Waiting for a device to press play";
}

export default function RelayApp({ room, initial }: { room: string; initial: Snapshot }) {
  const [engine] = useState(() => new RelayEngine(room, initial));
  const view = useSyncExternalStore(engine.subscribe, engine.getView, engine.getInitialView);
  const [pairUrl, setPairUrl] = useState<string | null>(null);

  useEffect(() => {
    engine.start();
    return () => engine.stop();
  }, [engine]);

  const attachPlayer = useCallback((element: HTMLVideoElement | null) => engine.attach(element), [engine]);

  const now = describe(view);
  const selfId = view.device?.id ?? null;
  const otherDevices = view.devices.filter((device) => device.id !== selfId).length;
  const isLive = now.status === "playing" || now.status === "buffering";
  const liveSourceId = isLive ? (now.mode === "source" ? selfId : (now.source?.id ?? null)) : null;
  const line = statusLine(now, otherDevices);
  const announcement = statusLine(now, otherDevices, false);
  const showVideo = now.mode === "source" && now.media?.kind === "video" && !now.error;
  const wide = now.media?.kind === "video";

  const playHere = (id: string) => {
    engine.play(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="relative isolate min-h-svh overflow-x-clip">
      {/* Ambient backdrop tinted by the current artwork */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[58rem] max-h-[140svh] overflow-hidden">
        {now.media && (
          <img
            key={now.media.id}
            src={now.media.thumbnail}
            alt=""
            className="fade-in h-full w-full scale-125 object-cover opacity-50 blur-[90px] saturate-150"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-ink/35 via-ink/70 to-ink" />
      </div>

      <div className="mx-auto w-full max-w-6xl px-[max(1rem,env(safe-area-inset-left))] pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 lg:px-10">
        <header className="flex h-14 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <LogoMark className="flex-none text-[1.75rem] text-live" />
            <span className="truncate text-xl font-semibold tracking-tight">Relay</span>
          </div>
          <div className="flex flex-none items-center gap-2">
            <SyncPill synced={view.synced} connected={view.connected} />
            <button
              type="button"
              onClick={() => setPairUrl(window.location.href)}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-medium text-bone ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/15"
            >
              <PlusIcon className="text-base" />
              Add device
            </button>
          </div>
        </header>

        <main>
          <p role="status" className="sr-only">
            {now.media ? `${announcement}: ${now.media.title} by ${now.media.artist}` : announcement}
          </p>

          {/* Now playing */}
          <section
            aria-label="Now playing"
            className="grid items-center gap-7 pt-4 sm:gap-9 sm:pt-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-14 lg:pt-12"
          >
            <div
              className={`relative mx-auto overflow-hidden rounded-[1.75rem] bg-panel shadow-[0_40px_80px_-32px_rgba(0,0,0,0.95)] ring-1 ring-white/10 ${
                wide ? "aspect-video w-[min(100%,124svh)]" : "aspect-square w-[min(100%,42svh)] lg:w-[min(100%,28rem,64svh)]"
              }`}
            >
              {now.media ? (
                <img
                  key={now.media.id}
                  src={now.media.thumbnail}
                  alt={`Artwork for ${now.media.title}`}
                  className="fade-in absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_30%_20%,#2b2b35,transparent_65%)]">
                  <LogoMark className="text-[5.5rem] text-white/15" />
                </div>
              )}

              {/* The one local player. Plays audio invisibly; shown only for video on the playing device. */}
              <video
                ref={attachPlayer}
                playsInline
                preload="metadata"
                onClick={engine.toggle}
                aria-label={now.media ? `${now.media.title} player` : "Media player"}
                aria-hidden={!showVideo}
                tabIndex={-1}
                className={`absolute inset-0 h-full w-full bg-black object-contain transition-opacity duration-300 ${
                  showVideo ? "cursor-pointer opacity-100" : "pointer-events-none opacity-0"
                }`}
              />

              {now.media && !showVideo && (
                <>
                  <span className="absolute left-3 top-3 rounded-full bg-ink/70 px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-bone backdrop-blur-md">
                    {now.media.kind}
                  </span>
                  {isLive && (
                    <span className="absolute bottom-3 left-3 flex h-8 items-center rounded-full bg-ink/70 px-3 text-bone backdrop-blur-md">
                      <Equalizer active={now.status === "playing"} />
                    </span>
                  )}
                </>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <StatusBadge status={now.status} mode={now.mode} />
                <p className="flex min-w-0 items-center gap-2 text-sm text-mute">
                  {now.mode === "viewer" && now.source && (
                    <DeviceIcon kind={now.source.kind} className="flex-none text-base" />
                  )}
                  {now.mode === "source" && view.device && (
                    <DeviceIcon kind={view.device.kind} className="flex-none text-base" />
                  )}
                  <span className="min-w-0 break-words">{line}</span>
                </p>
              </div>

              <h1 className="mt-4 break-words text-[clamp(2rem,6.5vw,3.75rem)] font-semibold leading-[1.02] tracking-tight text-balance">
                {now.media ? now.media.title : "Nothing playing yet"}
              </h1>
              <p className="mt-2.5 text-lg text-mute sm:text-xl">
                {now.media
                  ? now.media.artist
                  : "Press play on any device with this page open and it shows up here, live, on all the others."}
              </p>

              {now.media && (
                <Progress
                  position={now.position}
                  duration={now.duration}
                  seekable={now.mode === "source" && now.duration > 0}
                  onSeek={engine.seek}
                />
              )}

              {now.error && (
                <p role="alert" className="mt-4 rounded-xl border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-sm text-warn">
                  {now.error}
                </p>
              )}

              {now.mode === "source" && (
                <div className="mt-5 flex items-center justify-center gap-3 sm:gap-4 lg:justify-start">
                  <RoundButton label="Previous" onClick={engine.previous}>
                    <PreviousIcon />
                  </RoundButton>
                  <button
                    type="button"
                    onClick={engine.toggle}
                    aria-label={now.status === "paused" ? "Play" : "Pause"}
                    className="grid size-[4.25rem] place-items-center rounded-full bg-bone text-[2rem] text-ink transition hover:bg-white active:scale-95"
                  >
                    {now.status === "paused" ? <PlayIcon /> : <PauseIcon />}
                  </button>
                  <RoundButton label="Next" onClick={engine.next}>
                    <NextIcon />
                  </RoundButton>
                </div>
              )}

              {now.mode === "viewer" && now.source && (
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                  <button
                    type="button"
                    onClick={engine.takeOver}
                    className="inline-flex h-14 flex-none items-center justify-center gap-2.5 rounded-full bg-bone px-7 text-base font-semibold text-ink transition hover:bg-white active:scale-[0.98]"
                  >
                    <PlayIcon className="text-xl" />
                    Play on this device
                  </button>
                  <p className="text-sm leading-snug text-mute sm:max-w-[17rem]">
                    Moves playback here and picks up from the current position.
                  </p>
                </div>
              )}

              {now.mode === "idle" && (
                <div className="mt-7">
                  <button
                    type="button"
                    onClick={engine.toggle}
                    className="inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-bone px-7 text-base font-semibold text-ink transition hover:bg-white active:scale-[0.98] sm:w-auto"
                  >
                    <PlayIcon className="text-xl" />
                    Play something here
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Devices */}
          <section
            aria-labelledby="devices-heading"
            className="mt-9 rounded-3xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-md sm:p-5 lg:mt-14"
          >
            <h2 id="devices-heading" className="font-mono text-[11px] uppercase tracking-[0.18em] text-mute">
              {view.devices.length === 0
                ? "On this channel"
                : `On this channel · ${view.devices.length} ${view.devices.length === 1 ? "device" : "devices"}`}
            </h2>
            {view.devices.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {view.devices.map((device) => (
                  <li
                    key={device.id}
                    className={`inline-flex h-11 max-w-full items-center gap-2.5 rounded-full border bg-ink/60 pl-3.5 pr-4 text-sm ${
                      device.id === liveSourceId ? "border-live/60" : "border-white/10"
                    }`}
                  >
                    <DeviceIcon kind={device.kind} className="flex-none text-lg text-mute" />
                    <span className="truncate">{device.name}</span>
                    {device.id === selfId && (
                      <span className="flex-none rounded-full bg-white/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-bone">
                        You
                      </span>
                    )}
                    {device.id === liveSourceId && (
                      <span className="flex flex-none items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-wider text-live">
                        <span className="live-dot" />
                        Playing
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {view.devices.length === 0 && <p className="mt-3 text-sm text-mute">Looking for devices…</p>}
            {view.devices.length > 0 && otherDevices === 0 && (
              <p className="mt-3 text-sm leading-relaxed text-mute">
                Only this device so far. Use <span className="text-bone">Add device</span> to open the page on your
                phone, press play there, and this screen follows along.
              </p>
            )}
          </section>

          {/* Library */}
          <section aria-labelledby="library-heading" className="mt-10 lg:mt-14">
            <div className="flex items-baseline justify-between gap-4">
              <h2 id="library-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Library
              </h2>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-mute">{MEDIA.length} items</p>
            </div>
            <ul className="mt-5 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-5 sm:gap-y-8 lg:grid-cols-4">
              {MEDIA.map((item) => {
                const current = now.media?.id === item.id;
                return (
                  <li key={item.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => playHere(item.id)}
                      aria-label={`Play ${item.title} by ${item.artist} on this device`}
                      aria-current={current ? "true" : undefined}
                      className="group block w-full rounded-2xl text-left"
                    >
                      <span
                        className={`relative block aspect-square overflow-hidden rounded-2xl bg-panel ring-1 transition-shadow ${
                          current ? "ring-2 ring-live" : "ring-white/10 group-hover:ring-white/30"
                        }`}
                      >
                        <img
                          src={item.thumbnail}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                        <span className="absolute left-2.5 top-2.5 rounded-full bg-ink/70 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-bone backdrop-blur-md">
                          {item.kind}
                        </span>
                        {current ? (
                          <span className="absolute bottom-2.5 left-2.5 flex h-8 items-center rounded-full bg-live px-2.5 text-ink">
                            <Equalizer active={now.status === "playing"} />
                          </span>
                        ) : (
                          <span className="absolute bottom-2.5 right-2.5 grid size-10 translate-y-1 place-items-center rounded-full bg-bone text-lg text-ink opacity-0 shadow-lg transition group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
                            <PlayIcon />
                          </span>
                        )}
                      </span>
                      <span className="mt-3 block truncate font-medium">{item.title}</span>
                      <span className="block truncate text-sm text-mute">{item.artist}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </main>

        <footer className="mt-12 border-t border-white/10 pt-5 text-xs leading-relaxed text-mute">
          Demo audio by SoundHelix. Video and artwork from Pexels.
        </footer>
      </div>

      <ConnectDialog url={pairUrl} devices={view.devices} selfId={selfId} onClose={() => setPairUrl(null)} />
    </div>
  );
}

function SyncPill({ synced, connected }: { synced: boolean; connected: boolean }) {
  const label = !synced ? "Connecting" : connected ? "Connected" : "Reconnecting";
  const dot = synced && connected ? "bg-ok" : synced ? "bg-warn" : "bg-mute";
  return (
    <span
      role="status"
      className="inline-flex h-11 items-center gap-2 rounded-full px-2 font-mono text-[11px] uppercase tracking-[0.14em] text-mute min-[430px]:px-3"
    >
      <span className={`size-2 flex-none rounded-full ${dot}`} />
      <span className="sr-only min-[430px]:not-sr-only">{label}</span>
    </span>
  );
}

function StatusBadge({ status, mode }: { status: DisplayStatus; mode: NowPlaying["mode"] }) {
  const base =
    "inline-flex h-7 flex-none items-center gap-2 rounded-full px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em]";

  if (status === "playing") {
    return (
      <span className={`${base} bg-live text-ink`}>
        <span className="live-dot" />
        {mode === "source" ? "On air" : "Live"}
      </span>
    );
  }
  if (status === "buffering") {
    return (
      <span className={`${base} border border-white/20 text-bone`}>
        <span className="size-3 animate-spin rounded-full border-2 border-white/25 border-t-bone" />
        Loading
      </span>
    );
  }
  if (status === "offline") {
    return <span className={`${base} border border-warn/40 bg-warn/10 text-warn`}>Signal lost</span>;
  }
  if (status === "paused") {
    return <span className={`${base} border border-white/20 text-bone`}>Paused</span>;
  }
  return <span className={`${base} border border-white/15 text-mute`}>Standby</span>;
}

function RoundButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-14 place-items-center rounded-full text-2xl text-bone transition hover:bg-white/10 active:scale-95"
    >
      {children}
    </button>
  );
}

function Progress({
  position,
  duration,
  seekable,
  onSeek,
}: {
  position: number;
  duration: number;
  seekable: boolean;
  onSeek: (seconds: number) => void;
}) {
  const clamped = duration > 0 ? Math.min(Math.max(position, 0), duration) : 0;
  const percent = duration > 0 ? (clamped / duration) * 100 : 0;

  return (
    <div className="mt-6">
      <div className="relative flex h-9 items-center rounded-full has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-bone">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-bone transition-[width] duration-300 ease-linear"
            style={{ width: `${percent}%` }}
          />
        </div>
        {seekable ? (
          <>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-bone shadow-md transition-[left] duration-300 ease-linear"
              style={{ left: `${percent}%` }}
            />
            <input
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={clamped}
              onChange={(event) => onSeek(Number(event.target.value))}
              aria-label="Seek"
              aria-valuetext={`${formatTime(clamped)} of ${formatTime(duration)}`}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </>
        ) : (
          <span className="sr-only">
            {duration > 0 ? `${formatTime(clamped)} of ${formatTime(duration)}` : "Duration not known yet"}
          </span>
        )}
      </div>
      <div className="flex justify-between font-mono text-xs tabular-nums text-mute">
        <span>{formatTime(clamped)}</span>
        <span>{duration > 0 ? formatTime(duration) : "--:--"}</span>
      </div>
    </div>
  );
}
