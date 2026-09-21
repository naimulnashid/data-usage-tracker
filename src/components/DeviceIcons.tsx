/**
 * Device marks for the sidebar.
 *
 * Drawn inline rather than shipped as files: they are chrome, not app logos,
 * so they must take their colour from the surrounding text (`currentColor`)
 * and turn accent-coloured when their tab is active. A file in
 * `public/apps_logo/` could not do that, and would also put UI furniture into
 * the folder that means "an app we have a logo for".
 */

interface IconProps { size?: number }

/** A laptop, for the Windows machine. */
export function LaptopIcon({ size = 20 }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden focusable="false"
    >
      <rect x="3.5" y="4.5" width="17" height="11" rx="1.6" />
      <path d="M1.5 19.5h21" />
      <path d="M10 19.5l.5-1.6h3l.5 1.6" />
    </svg>
  );
}

/**
 * A plain phone.
 *
 * It carried an Android robot on its screen, which at 20px turned into three
 * indistinct marks inside a rectangle and read as noise rather than as a
 * platform. The row already says "Android" underneath; the icon only has to
 * say "handset", and an empty screen does that more clearly at this size.
 */
export function PhoneIcon({ size = 20 }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden focusable="false"
    >
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.4" />
      <path d="M10.6 19.3h2.8" />
    </svg>
  );
}

/**
 * The hamburger that collapses the sidebar.
 *
 * Stays a hamburger in both states rather than morphing into an X or a
 * chevron: it is a rail toggle, not a modal close, and an X invites the reader
 * to expect the sidebar to disappear entirely.
 */
export function MenuIcon({ size = 18 }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round"
      aria-hidden focusable="false"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
