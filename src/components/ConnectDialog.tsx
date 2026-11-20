"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import { CheckIcon, CloseIcon, CopyIcon, DeviceIcon } from "@/components/icons";
import type { DeviceInfo } from "@/lib/types";

interface Props {
  /** Link to share. `null` keeps the dialog closed. */
  url: string | null;
  devices: DeviceInfo[];
  selfId: string | null;
  onClose: () => void;
}

export function ConnectDialog({ url, devices, selfId, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (url && !dialog.open) dialog.showModal();
    if (!url && dialog.open) dialog.close();
  }, [url]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access denied: select the link so it can be copied by hand.
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

  const others = devices.filter((device) => device.id !== selfId);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="pair-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current?.close();
      }}
      className="sheet m-auto max-h-[92svh] w-[min(92vw,26rem)] overflow-y-auto rounded-[1.75rem] border border-white/10 bg-panel p-0 text-bone shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <div className="p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-mute">Add a device</p>
            <h2 id="pair-title" className="mt-1.5 text-2xl font-semibold leading-tight tracking-tight">
              Open this page on your phone
            </h2>
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Close"
            className="-mr-1.5 -mt-1.5 grid size-11 flex-none place-items-center rounded-full text-xl text-mute transition-colors hover:bg-white/10 hover:text-bone"
          >
            <CloseIcon />
          </button>
        </div>

        {url && (
          <div className="mt-5 flex justify-center rounded-2xl bg-bone p-4">
            <QRCodeSVG
              value={url}
              size={208}
              bgColor="#f4f1ea"
              fgColor="#09090b"
              level="M"
              title="QR code that opens this page"
              className="h-auto w-full max-w-[13rem]"
            />
          </div>
        )}

        <ol className="mt-5 space-y-2 text-sm leading-relaxed text-mute">
          <li>
            <span className="mr-2 font-mono text-bone">1</span>Scan the code with your phone&rsquo;s camera, or open the
            link below.
          </li>
          <li>
            <span className="mr-2 font-mono text-bone">2</span>Press play on the phone.
          </li>
          <li>
            <span className="mr-2 font-mono text-bone">3</span>This screen shows it live: artwork, title, progress and
            status.
          </li>
        </ol>

        <div className="mt-5 flex items-center gap-2">
          <label htmlFor="pair-link" className="sr-only">
            Link to this page
          </label>
          <input
            id="pair-link"
            ref={inputRef}
            readOnly
            value={url ?? ""}
            onFocus={(event) => event.currentTarget.select()}
            className="h-12 min-w-0 flex-1 rounded-xl border border-white/10 bg-ink px-3.5 font-mono text-xs text-bone"
          />
          <button
            type="button"
            onClick={copy}
            className="inline-flex h-12 flex-none items-center gap-2 rounded-xl bg-bone px-4 text-sm font-semibold text-ink transition-colors hover:bg-white"
          >
            {copied ? <CheckIcon className="text-base" /> : <CopyIcon className="text-base" />}
            <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>

        <div className="mt-6 border-t border-white/10 pt-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-mute">Other devices connected</p>
          {others.length === 0 ? (
            <p className="mt-2 text-sm text-mute">None yet. They appear here the moment they open the page.</p>
          ) : (
            <ul className="mt-2.5 space-y-2">
              {others.map((device) => (
                <li key={device.id} className="flex min-w-0 items-center gap-2.5 text-sm">
                  <DeviceIcon kind={device.kind} className="flex-none text-lg text-mute" />
                  <span className="truncate">{device.name}</span>
                  <span className="ml-auto flex flex-none items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-ok">
                    <span className="size-1.5 rounded-full bg-ok" />
                    Online
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </dialog>
  );
}
