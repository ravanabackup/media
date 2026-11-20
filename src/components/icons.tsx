import type { SVGProps } from "react";
import type { DeviceKind } from "@/lib/types";

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function LogoMark(props: IconProps) {
  return (
    <Base strokeWidth={2} {...props}>
      <circle cx="12" cy="12" r="2.25" fill="currentColor" stroke="none" />
      <path d="M7.4 16.6a6.5 6.5 0 0 1 0-9.2" />
      <path d="M16.6 7.4a6.5 6.5 0 0 1 0 9.2" />
      <path d="M4.2 19.8a11 11 0 0 1 0-15.6" opacity="0.55" />
      <path d="M19.8 4.2a11 11 0 0 1 0 15.6" opacity="0.55" />
    </Base>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Base stroke="none" fill="currentColor" {...props}>
      <path d="M8 5.14v13.72a1 1 0 0 0 1.52.86l11.1-6.86a1 1 0 0 0 0-1.72L9.52 4.28A1 1 0 0 0 8 5.14Z" />
    </Base>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <Base stroke="none" fill="currentColor" {...props}>
      <rect x="6" y="4.5" width="4.25" height="15" rx="1.25" />
      <rect x="13.75" y="4.5" width="4.25" height="15" rx="1.25" />
    </Base>
  );
}

export function NextIcon(props: IconProps) {
  return (
    <Base stroke="none" fill="currentColor" {...props}>
      <path d="M5 6.2v11.6a.9.9 0 0 0 1.4.75l8.6-5.8a.9.9 0 0 0 0-1.5L6.4 5.45A.9.9 0 0 0 5 6.2Z" />
      <rect x="16.5" y="5" width="2.5" height="14" rx="1" />
    </Base>
  );
}

export function PreviousIcon(props: IconProps) {
  return (
    <Base stroke="none" fill="currentColor" {...props}>
      <path d="M19 6.2v11.6a.9.9 0 0 1-1.4.75L9 12.75a.9.9 0 0 1 0-1.5l8.6-5.8A.9.9 0 0 1 19 6.2Z" />
      <rect x="5" y="5" width="2.5" height="14" rx="1" />
    </Base>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Base>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5.5 15H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h8.5A1.5 1.5 0 0 1 15 5v.5" />
    </Base>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Base strokeWidth={2.25} {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Base>
  );
}

export function PhoneIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="7" y="2.75" width="10" height="18.5" rx="2.5" />
      <path d="M11 18h2" />
    </Base>
  );
}

export function TabletIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4.5" y="2.75" width="15" height="18.5" rx="2.5" />
      <path d="M11 18h2" />
    </Base>
  );
}

export function MonitorIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="2.75" y="4" width="18.5" height="12.5" rx="2.25" />
      <path d="M8.5 20.25h7M12 16.5v3.75" />
    </Base>
  );
}

export function DeviceIcon({ kind, ...props }: IconProps & { kind: DeviceKind }) {
  if (kind === "mobile") return <PhoneIcon {...props} />;
  if (kind === "tablet") return <TabletIcon {...props} />;
  return <MonitorIcon {...props} />;
}

/** Animated level bars. Purely decorative; pair with a text label. */
export function Equalizer({ active, className = "" }: { active: boolean; className?: string }) {
  return (
    <span className={`eq ${active ? "" : "eq-paused"} ${className}`} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}
