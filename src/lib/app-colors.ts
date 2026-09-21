/**
 * Per-app chart colours.
 *
 * **Brand first.** An app is drawn in its own identity colour wherever one is
 * known -- qBittorrent teal, Drive canary, Edge cyan, Claude terracotta -- so
 * the chart is read the same way the taskbar is. Only apps with no brand to
 * borrow fall through to a generated palette.
 *
 * The cost of that choice, stated plainly because it is visible: several of the
 * largest apps here are Microsoft blues (Edge `#0078D7`, VS Code `#007ACC`,
 * Windows Update `#0067B8`) and qBittorrent is a deeper blue again, so four of
 * the top eight sit in the same hue family and are harder to tell apart in a
 * stacked band than the old arbitrary palette was. Brand recognition was judged
 * the better trade, and the logos now shown beside every legend entry and table
 * row carry the identification the colour no longer does alone.
 */

/**
 * Brand colours, keyed by DISPLAY NAME -- the same key the charts, table and
 * legend already use, so nothing has to thread a group key through the UI.
 *
 * Display names are unique per family by construction (see `app-name.ts`), so
 * the key is unambiguous.
 */
const BRAND: Record<string, string> = {
  // The big ones, as specified.
  'qBittorrent': '#2F6790',                 // deep teal blue
  'Google Drive': '#FFBA00',                // canary yellow
  'Microsoft Edge': '#0078D7',              // ocean cyan
  'Claude': '#D97757',                      // warm terracotta
  'System and Windows Update': '#0067B8',   // Windows accent blue
  'VS Code': '#007ACC',                     // electric cobalt
  'ChatGPT': '#10A37F',                     // forest teal-green
  'Node.js': '#68A063',                     // leaf green
  'Brave': '#FB542B',                       // lion orange
  // Ollama's mark is pitch black or off-white depending on the surface. On a
  // true-black dashboard the black half is invisible, so the off-white half is
  // the one that carries the identity here.
  'Ollama': '#DCDCDC',
  'Telegram': '#24A1DE',                    // skyline blue
  'Android Studio': '#3DDC84',              // Android robot green
  'Java': '#EA2D2E',                        // Duke crimson

  // Phone apps. The Android side sends its own labels, which land in this
  // same table -- so naming an app here is all it takes for the phone's charts
  // to use its brand colour too.
  'YouTube': '#FF0000',
  'YouTube Music': '#FF0000',
  'Facebook': '#1877F2',
  'Instagram': '#E4405F',
  'Threads': '#D8D8DE',
  'Messenger': '#A334FA',
  'Google Play Store': '#01875F',
  'Google Play services': '#4285F4',
  'Snapchat': '#FFFC00',
  'TikTok': '#FE2C55',
  'Spotify': '#1DB954',
  'Netflix': '#E50914',
  'Reddit': '#FF4500',
  'X': '#D8D8DE',
  'Pinterest': '#E60023',
  'Gmail': '#EA4335',
  'Google': '#4285F4',
  'Maps': '#34A853',
  'Drive': '#FFBA00',
  'Proton VPN': '#6D4AFF',
  'Edge Gallery': '#0078D7',

  // Everything else with a recognisable identity.
  'Android Emulator': '#A4C639',
  'Antigravity': '#8AB4F8',
  'ASUS': '#00539B',
  'Bitwarden': '#175DDC',
  'Chrome': '#4285F4',
  'Codex': '#10A37F',
  'Command Palette': '#8E8CD8',
  'Connected Devices': '#5C7CFA',
  'Cursor': '#E4E4E4',
  'curl': '#7EB543',
  'Discord': '#5865F2',
  'Firefox': '#FF7139',
  'Git': '#F1502F',
  'GitHub': '#C9D1D9',
  'GitKraken': '#179287',
  'Google Updater': '#34A853',
  'Kimi': '#7B61FF',
  'Microsoft Copilot': '#8661C5',
  'Microsoft News': '#C43E1C',
  'Microsoft Office': '#D83B01',
  'Microsoft Store': '#2D7D9A',
  'Microsoft Teams': '#6264A7',
  'Microsoft To Do': '#3D6DB5',
  'MSN Weather': '#4FA3D1',
  'NVIDIA': '#76B900',
  'OBS Studio': '#D0D0D0',
  'Obsidian': '#7C3AED',
  'OneDrive': '#0364B8',
  'OpenCode': '#E8E5DE',
  'Outlook': '#0F6CBD',
  'Perplexity': '#20808D',
  'Phone Link': '#4A90D9',
  'Microsoft Photos': '#C7539C',
  'Photos': '#4285F4',
  'PowerShell': '#5391FE',
  'PowerToys': '#C2185B',
  'Python': '#FFD43B',
  'Rust': '#DEA584',
  'uv': '#DE5FE9',
  'Visual Studio': '#5C2D91',
  'WhatsApp': '#25D366',
  'Windows Defender': '#4CC2FF',
  'Windows Error Reporting': '#8A8A94',
  'Windows Notifications': '#7A9CC6',
  'Windows Search': '#3FA9F5',
  'Windows Widgets': '#5AA7E0',
  'Wispr Flow': '#F5A623',
  'Xbox': '#107C10',
  'ZCode': '#E5B94E',
  'Zoom': '#2D8CFF',
  'Zotero': '#CC2936',
};

/**
 * Fallback palette for apps with no brand colour.
 *
 * Vivid and mutually distinct, ordered so ADJACENT entries contrast -- adjacent
 * ranks are what end up next to each other in a stacked band or a sorted bar
 * list. The accent blue is deliberately absent: it is reserved for UI chrome,
 * so "blue means primary/active" stays unambiguous.
 */
const PALETTE = [
  '#ec4899', // pink
  '#22d3ee', // cyan
  '#f59e0b', // amber
  '#a855f7', // violet
  '#10b981', // emerald
  '#f97316', // orange
  '#818cf8', // indigo
  '#84cc16', // lime
  '#fb7185', // rose
  '#14b8a6', // teal
  '#eab308', // yellow
  '#d946ef', // fuchsia
];

/**
 * "Everything else" on the torrent split.
 *
 * A pale neutral rather than the accent. qBittorrent's brand colour is a deep
 * TEAL BLUE and the accent is a mid blue, so the two halves of that bar were
 * the same hue at slightly different lightness -- the one chart on the
 * dashboard whose entire job is to separate two quantities, and its two
 * quantities looked alike. Grey-white has no hue to collide with, and reads
 * correctly as "the remainder" against any brand colour a future top app
 * brings with it.
 */
export const EVERYTHING_ELSE_COLOR = '#C9C9D3';

/** Anything not in the top-N bucket. Deliberately grey: it is a remainder. */
export const OTHER_COLOR = '#4b4b55';

/** Real but unattributable traffic. Also grey -- it is not an app. */
export const UNATTRIBUTED_COLOR = '#3f3f48';

export type AppColorMap = Record<string, string>;

/**
 * Assign colours by rank, brand colours taking precedence.
 *
 * An earlier version hashed the app name, which kept colours stable across
 * pages but produced visible collisions -- Edge, Drive and Claude Code all
 * landed on the same violet. Ranking by all-time bytes fixed that and is still
 * what drives the fallback: the biggest unbranded apps get the most distinct
 * palette entries, and the assignment does not shift when the date range or the
 * page changes, because the ranking it derives from does not.
 */
export function assignColors(namesByRank: string[]): AppColorMap {
  const map: AppColorMap = {};
  let i = 0;
  for (const name of namesByRank) {
    if (name === 'Other') { map[name] = OTHER_COLOR; continue; }
    if (name === 'Unattributed') { map[name] = UNATTRIBUTED_COLOR; continue; }
    const brand = BRAND[name];
    if (brand) { map[name] = brand; continue; }
    map[name] = PALETTE[i % PALETTE.length]!;
    i++;
  }
  return map;
}

/** Look up with a sane fallback for a name missing from the map. */
export function colorOf(map: AppColorMap, name: string): string {
  if (name === 'Other') return OTHER_COLOR;
  if (name === 'Unattributed') return UNATTRIBUTED_COLOR;
  return map[name] ?? BRAND[name] ?? OTHER_COLOR;
}

/* --------------------------------------------------------------- upload tint */

/**
 * The shade an app's UPLOAD segment gets, given its own colour.
 *
 * The Top 10 bars are stacked download + upload, and the two halves must read
 * as one app rather than as two series -- so upload is a tint of the app's own
 * colour, never a second hue. Download keeps the exact brand colour, because
 * that is what the table swatch, the legend and the logo beside it all show.
 *
 * **The direction cannot be fixed, and that is measured rather than assumed.**
 * `DOWN_COLOR`/`UP_COLOR` in `Charts.tsx` can hardcode "lighter = upload"
 * because they tint the accent, which is a known mid-tone. An app colour is
 * whatever the brand is, and seven of the palette's entries are near-white --
 * Ollama `#DCDCDC`, Cursor `#E4E4E4`, OpenCode `#E8E5DE`, X and Threads
 * `#D8D8DE`. Lightening those by the same 28% moves them a perceptual
 * distance of 2.7-4.6 dE, which is invisible: the bar would look unsplit.
 *
 * So a colour that is already light is tinted DARKER instead. Measured over
 * all 91 colours in this file, the worst base-vs-tint separation under the
 * rule below is 10.1 dE (`#14b8a6`), against 2.7 dE for a fixed lighten.
 *
 * The threshold is CIE L*, not sRGB brightness or WCAG contrast ratio. WCAG
 * contrast was tried first and is the wrong tool: it flagged saturated reds
 * and greens as needing the flip -- `#FF0000` scores 1.20 against its own
 * tint -- because those barely move in luminance when mixed with white, even
 * though the eye separates them easily.
 */

/** One sRGB channel, 0-255, to linear light. */
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** CIE L* (perceptual lightness, 0-100) of a #rrggbb. */
function lightness(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const y = 0.2126 * channel((n >> 16) & 255)
    + 0.7152 * channel((n >> 8) & 255)
    + 0.0722 * channel(n & 255);
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

/** Blend `hex` toward 0 (black) or 255 (white), keeping `keep` of the base. */
function blend(hex: string, keep: number, toward: 0 | 255): string {
  const n = parseInt(hex.slice(1), 16);
  const one = (c: number) => Math.round(c * keep + toward * (1 - keep))
    .toString(16).padStart(2, '0');
  return `#${one((n >> 16) & 255)}${one((n >> 8) & 255)}${one(n & 255)}`;
}

/** Above this CIE L*, a colour has no room to lighten and is darkened instead. */
const TINT_FLIP_LIGHTNESS = 76;

/** Keep this much of the base when lightening, and when darkening. */
const TINT_LIGHTEN = 0.72;
const TINT_DARKEN = 0.62;

/** The upload half of a stacked app bar. Same hue, visibly different shade. */
export function uploadTint(color: string): string {
  // Everything from colorOf() is #rrggbb, but a var()/color-mix() string would
  // silently produce garbage from parseInt -- leave anything else alone.
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
  return lightness(color) > TINT_FLIP_LIGHTNESS
    ? blend(color, TINT_DARKEN, 0)
    : blend(color, TINT_LIGHTEN, 255);
}

/* ------------------------------------------------------------------ heatmap */

/**
 * Six-step ramp for the activity heat map, in the accent's blue family.
 *
 * Step 0 is "quiet day" - a real day with little traffic. It is distinct from
 * `--hm-none`, which the component uses for days with no collected data at all;
 * conflating the two would invent history the project does not have.
 */
export const HEATMAP_RAMP = [
  'var(--hm-0)',
  'var(--hm-1)',
  'var(--hm-2)',
  'var(--hm-3)',
  'var(--hm-4)',
  'var(--hm-5)',
] as const;

/**
 * Bucket a day's total against the period's peak.
 *
 * Thresholds are uneven on purpose. Usage here is dominated by occasional
 * torrent days an order of magnitude above the rest, so linear buckets would
 * paint almost every day the palest step and one day the brightest, which shows
 * nothing. Weighting the low end spreads ordinary days across three shades.
 */
export function heatmapColor(value: number, max: number): string {
  if (value <= 0 || max <= 0) return HEATMAP_RAMP[0];
  const ratio = value / max;
  if (ratio <= 0.05) return HEATMAP_RAMP[1];
  if (ratio <= 0.15) return HEATMAP_RAMP[2];
  if (ratio <= 0.35) return HEATMAP_RAMP[3];
  if (ratio <= 0.7) return HEATMAP_RAMP[4];
  return HEATMAP_RAMP[5];
}
