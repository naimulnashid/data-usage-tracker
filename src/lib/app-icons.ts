/**
 * App logos.
 *
 * **Logos are per device.** Each device owns a folder under
 * `public/apps_logo/` and sees only what is in it:
 *
 *   public/apps_logo/my-pc/         the laptop
 *   public/apps_logo/pixel-8/       a phone
 *   public/apps_logo/galaxy-a54/    another phone
 *
 * **A folder's name is its device's URL slug**, for every device including the
 * laptop, so `/windows/my-pc` and `apps_logo/my-pc/` cannot drift
 * apart. See the note below `LOGO_ROOT` for the one way they still can.
 *
 * **Dropping a file into a device's folder is enough.** That folder is scanned
 * per request (see `app-icons-server.ts`), and a file whose name matches an
 * app's display name is picked up with no code change and no rebuild --
 * `Bitwarden.svg` finds "Bitwarden", `Microsoft To Do.svg` finds "Microsoft To
 * Do". Matching ignores case, so `Nvidia.png` finds "NVIDIA".
 *
 * **An app on two devices needs the file in both folders.** There is
 * deliberately no shared tier and no fallback to a sibling folder, and the
 * duplication is the price of the thing that makes this worth doing: the
 * aliases below are global, so one folder's contents cannot leak a mark onto a
 * device where it is wrong. `Settings` is aliased to `Windows`, and the phones
 * both have an app called Settings -- while every logo sat in one directory,
 * Android's Settings rendered the Windows flag. Not copying `Windows.svg` into
 * the phone folders is the entire fix.
 *
 * The cost to accept: a newly added phone shows colour swatches until its
 * folder is populated, and a file dropped at the root of `apps_logo/` belongs
 * to nobody and is never served.
 *
 * The table below is only for names that CANNOT match a file name:
 *
 * - **Members.** "Claude Code" and "Claude Desktop" are separate programs
 *   inside the Claude family and appear by name in the merged-apps breakdown;
 *   both should show the Claude mark rather than one file per member.
 * - **Shared marks.** Two dozen Windows components legitimately share
 *   `Windows.svg`.
 * - **File names that differ from the app name**, like `ChatGPT Green.png`.
 *
 * Nothing here is required for a new logo to appear. It is required only to
 * point several names at one file.
 */

/** Where the per-device folders live, relative to the project root. */
export const LOGO_ROOT = ['public', 'apps_logo'] as const;

/*
 * The laptop has no folder-name constant, deliberately.
 *
 * It used to: a `WINDOWS_LOGOS` constant, back when the laptop sat
 * on bare URLs and had no slug of its own. Now that it lives at
 * `/windows/<slug>` the folder IS that slug -- `windowsSlug()` in `queries.ts`
 * -- exactly as a phone's is, so one rule covers every device and the URL and
 * the folder cannot drift apart.
 *
 * The cost is real and worth stating: the laptop's slug is derived from
 * `deviceLabel` in `config/collector.json`, so **renaming the machine in config
 * renames its URL and orphans `public/apps_logo/<old slug>/`.** Every app falls
 * back to a colour swatch, which looks like a rendering bug rather than a
 * rename. Rename the folder in the same commit.
 */

/** Display name -> the file's name without its extension. */
export const ICON_ALIASES: Record<string, string> = {
  // File name differs from the app name
  'ChatGPT': 'ChatGPT Green',
  'Microsoft Office': 'Office',
  'Microsoft Teams': 'Teams',
  'Google Updater': 'Google',
  'Android Emulator': 'Android Studio',
  // The phone labels Google Photos simply 'Photos'.
  'Photos': 'Google Photos',
  'YouTube Music': 'Youtube Music',

  // Windows components share one mark
  'System and Windows Update': 'Windows',
  'Windows Notifications': 'Windows',
  'Windows Search': 'Windows',
  'Windows Widgets': 'Windows',
  'Windows Explorer': 'Windows',
  'Windows Error Reporting': 'Windows',
  'Windows Telemetry': 'Windows',
  'Windows Task Host': 'Windows',
  'Connected Devices': 'Windows',
  'Settings': 'Windows',
  'Start Menu': 'Windows',
  'Shell Experience Host': 'Windows',
  'Content Delivery Manager': 'Windows',
  'Cloud Experience Host': 'Windows',
  'Work or School Account': 'Windows',
  'Microsoft Account Sign-in': 'Windows',
  'Cryptographic Services': 'Windows',
  'Connected User Experiences': 'Windows',
  'App Installer': 'Microsoft Store',
  'Microsoft Store Install Service': 'Microsoft Store',
  'Windows SmartScreen': 'Windows Defender',

  // Members, so the merged-apps breakdown on a detail page is illustrated too
  'Claude Code': 'Claude',
  'Claude Desktop': 'Claude',
  'Claude Installer': 'Claude',
  'Codex': 'ChatGPT Green',
  'Codex Sandbox': 'ChatGPT Green',
  'Ollama Desktop': 'Ollama',
  'Edge WebView2': 'Microsoft Edge',
  'Edge Updater': 'Microsoft Edge',
  'Brave Updater': 'Brave',
  'Bitwarden Installer': 'Bitwarden',
  'Android Emulator (QEMU)': 'Android Studio',
  'Antigravity IDE': 'Antigravity',
  'Antigravity Language Server': 'Antigravity',
  'GitHub CLI': 'GitHub',
  'GitHub Desktop': 'GitHub',
  'GitHub Desktop Updater': 'GitHub',
  'GitHub Copilot': 'GitHub',
  'Windows PowerShell': 'Powershell',
  'PowerShell 7': 'Powershell',
  'NVIDIA App': 'Nvidia',
  'NVIDIA Container': 'Nvidia',
  'NVIDIA Overlay': 'Nvidia',
  'NVIDIA Display Container': 'Nvidia',
  'NVIDIA DLSS Update': 'Nvidia',
  'NVIDIA Installer': 'Nvidia',
  'OneDrive Sync': 'OneDrive',
  'OneDrive Launcher': 'OneDrive',
  'OneDrive Updater': 'OneDrive',
  'OneDrive Co-authoring': 'OneDrive',
  'Word': 'Office',
  'Excel': 'Office',
  'PowerPoint': 'Office',
  'OneNote': 'Office',
  'Office Helper': 'Office',
  'Office Hub': 'Office',
  'Office Actions': 'Office',
  'Office Notifications': 'Office',
  'Office Click-to-Run': 'Office',
  'ASUS Software Manager': 'ASUS',
  'ASUS Software Manager Agent': 'ASUS',
  'ASUS Update': 'ASUS',
  'ASUS Verify': 'ASUS',
  'ASUS PC Assistant': 'ASUS',
  'Armoury Crate': 'ASUS',
  'ASUS App Service': 'ASUS',
  'ROG Live Service': 'ASUS',
  'Delivery Optimisation': 'Windows',
  'Background Transfer (BITS)': 'Windows',
  'Windows Update': 'Windows',
  'Update Orchestrator': 'Windows',
  'Update Medic': 'Windows',
  'Windows Update Orchestrator': 'Windows',
  'Windows Server-Initiated Healing': 'Windows',
  'Microsoft Defender Antivirus': 'Windows Defender',
  'Microsoft Defender Core': 'Windows Defender',
  'Windows Push Notifications': 'Windows',
  'Windows Push Notifications (user)': 'Windows',
  'Connected Devices Platform': 'Windows',
  'Connected Devices Platform (user)': 'Windows',
  'Gaming Services': 'Xbox',
  'Xbox Game Bar': 'Xbox',
  'Xbox Live Auth': 'Xbox',
};

/**
 * Logos dark enough to vanish on a true-black card, keyed by lowercase file
 * stem. They render on a light plate.
 *
 * **This cannot be a blanket rule and cannot be guessed.** Measured mean luma
 * over the non-transparent pixels: ASUS is a pure-black wordmark, OpenCode is
 * `#4B4646`, Cursor's cube averages 69/255. Ollama looks like it belongs here
 * and does NOT -- the file shipped is the off-white variant, luma 221 -- and a
 * plate would have erased it, along with Brave, Chrome, Teams, Telegram and
 * qBittorrent, which are all white-on-transparent.
 *
 * **Mean luma is the wrong statistic for a full-bleed TILE, though**, and X and
 * Threads are why this list no longer names them. Their old `.svg` files
 * carried no `fill` at all, so they rendered in the SVG default -- black -- and
 * were genuinely invisible rather than merely dark. The `.png` tiles that
 * replaced them measure DARKER by this rule (mean luma 30.7 and 49.7, below
 * every stem above) and yet read perfectly, because ~99% of their pixels are
 * opaque: they are rounded squares whose own near-black ground merges into the
 * card while the mark itself stays light (11% and 19.5% of opaque pixels above
 * luma 180). A plate would have boxed them in white for nothing.
 *
 * So measure the MARK, not the file: a sparse glyph is judged by its mean, a
 * tile by whether it carries a light glyph of its own.
 */
export const PLATE_STEMS = new Set(['asus', 'opencode', 'cursor']);

export interface AppIconSpec {
  src: string;
  plate: boolean;
}

/** Lowercased display name -> logo. Built by `getAppIconMap()`. */
export type AppIconMap = Record<string, AppIconSpec>;

/** The logo for an app or member name, or null when no file matches. */
export function iconOf(map: AppIconMap, name: string): AppIconSpec | null {
  return map[name.toLowerCase()] ?? null;
}
