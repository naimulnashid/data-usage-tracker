/**
 * Accent colours. **The single place any of them is defined.**
 *
 * The dashboard now covers more than one device, and each gets its own accent
 * so you can tell at a glance which machine you are looking at -- Tech Blue for
 * the laptop, Android Green for the phone.
 *
 * Everything downstream already reads `var(--accent)` and friends, so switching
 * device is one attribute on the shell (`data-device`) and nothing else. The
 * rule that makes that work, and which must not be broken:
 *
 *   **Never hardcode an accent hex anywhere else.** Not in CSS, not in a chart.
 *   `Charts.tsx` used to carry `#2f80ed` and `#4d97ff` inline, which meant the
 *   trend chart stayed blue on a green page. Recharts passes stroke/fill
 *   straight through to SVG attributes, and `var(--accent)` is valid there, so
 *   there is no reason to inline one.
 *
 * These are emitted as CSS custom properties by `accentStyleSheet()`, which the
 * root layout inlines. They are deliberately NOT duplicated in `globals.css` --
 * two sources would drift, and the whole point of this file is that there is
 * one.
 */

export type DeviceId = 'windows' | 'android';

export interface AccentTheme {
  /** Primary. Buttons, active tabs, the headline total. */
  accent: string;
  /** Lifted variant for hover and for text on black. */
  accentBright: string;
  /** Translucent fill behind active chips and badges. */
  accentDim: string;
  /** Glow, since a black-on-black drop shadow does nothing. */
  accentGlow: string;
  /**
   * Fill for SOLID controls -- the active range chip, the login button -- and
   * the text that sits on it. A pair, because which text reads on a fill
   * depends on the fill: white on Tech Blue measured 3.87:1 and white on
   * Android Green 1.78:1, both under WCAG AA's 4.5:1 (2026-09-21). Blue keeps
   * white text on a fill deepened just past 4.5; green is light enough that
   * near-black text reads at 10.6:1 on the brand colour itself.
   */
  accentFill: string;
  onAccentFill: string;
  /**
   * Five-step heat map ramp, in the accent's own hue family.
   *
   * Step 0 is a real but quiet day and stays near-neutral; `--hm-none` (a day
   * with no collected data at all) lives in globals.css because it is not
   * accent-derived and must never read as a quiet day.
   */
  heatmap: [string, string, string, string, string, string];
}

/** `rgba()` from a #rrggbb, so a theme is defined by one hex per role. */
function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const TECH_BLUE = '#2f80ed';
const ANDROID_GREEN = '#3ddc84';

/** The dark theme's accents -- the dashboard's original, true-black look. */
export const ACCENTS: Record<DeviceId, AccentTheme> = {
  windows: {
    accent: TECH_BLUE,
    accentBright: '#4d97ff',
    accentDim: alpha(TECH_BLUE, 0.16),
    accentGlow: alpha(TECH_BLUE, 0.28),
    accentFill: '#1570eb',    // white on it: 4.62:1
    onAccentFill: '#ffffff',
    heatmap: ['#131519', '#12325c', '#17488a', '#1f62bd', '#2f80ed', '#6fb0ff'],
  },
  android: {
    accent: ANDROID_GREEN,
    // Android's own green is already light; the "bright" step lifts it just
    // enough to stay distinct on hover without turning mint.
    accentBright: '#66eda5',
    accentDim: alpha(ANDROID_GREEN, 0.16),
    accentGlow: alpha(ANDROID_GREEN, 0.28),
    accentFill: ANDROID_GREEN,
    onAccentFill: '#06140c',  // on the green: 10.57:1
    heatmap: ['#131519', '#0d3a24', '#125234', '#1a7b4c', '#3ddc84', '#8af0b8'],
  },
};

/**
 * The light theme's accents. Same hue per device, deepened until it reads as
 * TEXT on white: the dark theme's Tech Blue is 3.87:1 on white and Android
 * Green 1.78:1, and both are used for links, the headline figure and active
 * tabs. Measured 2026-09-30 against white, the #f4f5f7 page and the
 * accent-dim tint behind active chips:
 *
 *   #1664d9  5.44 / 4.99 / 4.93     #0f5bc4 (bright)  6.34 / 5.81
 *   #0d7340  5.93 / 5.43 / 5.36     #0b6b3a (bright)  6.61 / 6.06
 *
 * "Bright" is the hover and emphasis step, so on white it goes DARKER, not
 * lighter. White on either fill clears 5.4:1.
 *
 * The heat map runs light to dark here -- more traffic, more ink -- which is
 * the convention on a light page, and step 0 is a pale neutral so a quiet day
 * still reads as a day. (#e9edf3 until 2026-10-01, which barely showed on a
 * white card.)
 */
export const LIGHT_ACCENTS: Record<DeviceId, AccentTheme> = {
  windows: {
    accent: '#1664d9',
    accentBright: '#0f5bc4',
    accentDim: alpha('#1664d9', 0.1),
    accentGlow: alpha('#1664d9', 0.24),
    accentFill: '#1664d9',
    onAccentFill: '#ffffff',
    heatmap: ['#e1e6ed', '#c7dcf8', '#94bdf2', '#5b99e8', '#2a74dc', '#1252b0'],
  },
  android: {
    accent: '#0d7340',
    accentBright: '#0b6b3a',
    accentDim: alpha('#0d7340', 0.1),
    accentGlow: alpha('#0d7340', 0.24),
    accentFill: '#0d7340',
    onAccentFill: '#ffffff',
    heatmap: ['#e1e6ed', '#c3ead3', '#8dd6ad', '#4dba80', '#1f9457', '#0d6b3c'],
  },
};

/**
 * The device a path belongs to. One rule, used by both the shell and the nav.
 *
 * Keys off the platform segment, not the slug: `/android/...` is the phone,
 * everything else -- `/windows/...`, `/login`, the redirect stubs on the old
 * bare URLs -- is the laptop. Defaulting rather than returning null keeps the
 * pages outside the device shell on a real accent instead of an unstyled one.
 */
export function deviceOf(pathname: string): DeviceId {
  return pathname === '/android' || pathname.startsWith('/android/') ? 'android' : 'windows';
}

function block(selector: string, t: AccentTheme): string {
  return `${selector}{`
    + `--accent:${t.accent};`
    + `--accent-bright:${t.accentBright};`
    + `--accent-dim:${t.accentDim};`
    + `--accent-glow:${t.accentGlow};`
    + `--accent-fill:${t.accentFill};`
    + `--on-accent-fill:${t.onAccentFill};`
    + t.heatmap.map((c, i) => `--hm-${i}:${c};`).join('')
    + '}';
}

/**
 * The whole accent layer as CSS text, inlined by the root layout.
 *
 * `:root` carries the laptop's blue so anything outside the device shell --
 * the login page, the not-found page -- still has an accent. Each device then
 * overrides it from `[data-device]` on the shell.
 */
export function accentStyleSheet(): string {
  return [
    block(':root', ACCENTS.windows),
    ...Object.entries(ACCENTS).map(([id, t]) => block(`[data-device='${id}']`, t)),
    // The light theme is `data-theme` on <html>, set before first paint by
    // the script in the root layout. One more attribute in each selector
    // outranks the dark blocks above without !important.
    block(":root[data-theme='light']", LIGHT_ACCENTS.windows),
    ...Object.entries(LIGHT_ACCENTS).map(([id, t]) => block(`[data-theme='light'] [data-device='${id}']`, t)),
  ].join('');
}
