/**
 * Interface icons: the controls' and the network kinds' marks.
 *
 * Inline, like DeviceIcons, and for the same reason: they are chrome, so they
 * take their colour from the text around them (`currentColor`) and follow the
 * theme and the accent with no colour of their own. One 24-unit square and
 * one stroke weight, so any two read as a set.
 */

interface IconProps { size?: number | string }

function Svg({ size = 16, children, strokeWidth = 1.8 }: IconProps & { children: React.ReactNode; strokeWidth?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden focusable="false" className="icon"
    >
      {children}
    </svg>
  );
}

/** Wi-Fi: three arcs over a dot. */
export function WifiIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 9a14 14 0 0 1 19 0" />
      <path d="M5.8 12.6a9 9 0 0 1 12.4 0" />
      <path d="M9.1 16.1a4.2 4.2 0 0 1 5.8 0" />
      <circle cx="12" cy="19.4" r="0.6" fill="currentColor" />
    </Svg>
  );
}

/** Wired: an Ethernet port. */
export function WiredIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7.5h16v10H15v2.5H9v-2.5H4z" />
      <path d="M8 11v2.5M11 11v2.5M14 11v2.5M17 11v2.5" />
    </Svg>
  );
}

/** Mobile data: four signal bars. */
export function MobileDataIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 19v-3M10 19v-6M15 19v-9M20 19V6" strokeWidth={2.4} />
    </Svg>
  );
}

/** A network of no known kind: a globe. */
export function GlobeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5s1.1-5.9 3.6-8.5z" />
    </Svg>
  );
}

export function CalendarIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="5" width="17" height="15" rx="2.2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </Svg>
  );
}

export function TableIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Svg>
  );
}

export function GridIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.4" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4" />
    </Svg>
  );
}

/** Three dots: the row's actions. */
export function MoreIcon(p: IconProps) {
  return (
    <Svg {...p} strokeWidth={2.6}>
      <path d="M6 12h.01M12 12h.01M18 12h.01" />
    </Svg>
  );
}

export function EyeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </Svg>
  );
}

export function EyeOffIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.3 7.4A15.6 15.6 0 0 0 2.5 12S6 18.5 12 18.5c1.8 0 3.3-.5 4.6-1.3" />
      <path d="M9.9 10a2.8 2.8 0 0 0 4 4M3.5 3.5l17 17" />
    </Svg>
  );
}

/** Two paths joining into one. */
export function MergeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 3.5v4.5a5 5 0 0 0 5 5h1" />
      <path d="M18 3.5v4.5a5 5 0 0 1-5 5h-1v7.5" />
      <path d="M8.5 18l3.5 3 3.5-3" />
    </Svg>
  );
}

/** One path splitting in two: undoing a merge. */
export function SplitIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 20.5V13" />
      <path d="M12 13c0-3-2.5-5-6-5.5M12 13c0-3 2.5-5 6-5.5" />
      <path d="M4 4.5l2 3-3 1.5M20 4.5l-2 3 3 1.5" />
    </Svg>
  );
}
