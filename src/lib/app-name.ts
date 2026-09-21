/**
 * Turning raw SRUM identities into the names a person recognises.
 *
 * Three layers, applied in order, and the distinction between them matters:
 *
 *   1. **Identity -> member.** One raw string becomes one *member*: an exe
 *      basename, a version-stripped AppX package, a version-stripped service.
 *      This is the layer that collapses `...\129.0.1.0\googledrivefs.exe` and
 *      `...\128.0.0.0\googledrivefs.exe` into one thing.
 *
 *   2. **Member -> family.** Several members that are one product to a human
 *      become one *family*: `claude.exe` (the CLI) and the `Claude` store app;
 *      `ollama.exe` and `ollama app.exe`; every NVIDIA background process.
 *      This layer is what the dashboard groups and charts on.
 *
 *   3. **Naming.** Both layers carry a display name, so a detail page can say
 *      "Claude, assembled from Claude Code + Claude Desktop" rather than
 *      silently folding one into the other.
 *
 * Layers 1 and 2 change the NUMBERS -- that is the point. A product split
 * across several identity strings otherwise shows up several times, each entry
 * looking smaller than the truth.
 *
 * Naming lives here rather than in the database so every rule below can be
 * corrected without re-ingesting anything.
 */

import type { AppKind } from './srum.js';

export interface ResolvedApp {
  /** Group on this. Rows sharing a groupKey are the same real product. */
  groupKey: string;
  /** What to show the user for the group. */
  displayName: string;
  kind: AppKind;
  /**
   * The pre-merge identity: one per distinct program inside the family.
   * Equal to `groupKey` when nothing was merged.
   */
  memberKey: string;
  /** What to show for that individual program. */
  memberName: string;
}

/* ------------------------------------------------------------------ */
/* Layer 1 -- names for individual members                             */
/* ------------------------------------------------------------------ */

/**
 * Proper names for executables, keyed by lowercase basename.
 *
 * SRUM lowercases everything and Windows reads real casing from file metadata,
 * which we do not have -- so without this table the dashboard shows
 * `googledrivefs.exe` where a person would say "Google Drive". Falls back to
 * the raw basename, so an unlisted program still renders sensibly.
 */
const KNOWN_EXE_NAMES: Record<string, string> = {
  // Browsers
  'msedge.exe': 'Microsoft Edge',
  'msedgewebview2.exe': 'Edge WebView2',
  'microsoftedgeupdate.exe': 'Edge Updater',
  'brave.exe': 'Brave',
  'braveupdate.exe': 'Brave Updater',
  'chrome.exe': 'Chrome',
  'firefox.exe': 'Firefox',

  // AI tools
  'claude.exe': 'Claude Code',
  'claude setup.exe': 'Claude Installer',
  'codex.exe': 'Codex',
  'node_repl.exe': 'Codex Sandbox',
  'ollama.exe': 'Ollama',
  'ollama app.exe': 'Ollama Desktop',
  'cursor.exe': 'Cursor',
  'opencode.exe': 'OpenCode',
  'zcode.exe': 'ZCode',
  'antigravity ide.exe': 'Antigravity IDE',
  'antigravity.exe': 'Antigravity',
  'language_server_windows_x64.exe': 'Antigravity Language Server',
  'language_server.exe': 'Antigravity Language Server',
  'perplexity ai.exe': 'Perplexity',
  'kimi.exe': 'Kimi',
  'mscopilot.exe': 'Microsoft Copilot',
  'wispr flow.exe': 'Wispr Flow',

  // Dev tooling
  'code.exe': 'VS Code',
  'node.exe': 'Node.js',
  'python.exe': 'Python',
  'pythonw.exe': 'Python',
  'java.exe': 'Java',
  'javaw.exe': 'Java',
  'studio64.exe': 'Android Studio',
  'netsimd.exe': 'Android Emulator',
  'qemu-system-x86_64.exe': 'Android Emulator (QEMU)',
  'qemu-system-x86_64-headless.exe': 'Android Emulator (QEMU)',
  'git-remote-https.exe': 'Git',
  'gh.exe': 'GitHub CLI',
  'github.exe': 'GitHub Copilot',
  'githubdesktop.exe': 'GitHub Desktop',
  'gk.exe': 'GitKraken',
  'cargo.exe': 'Cargo',
  'rustup-init.exe': 'Rustup',
  'uv.exe': 'uv',
  'curl.exe': 'curl',
  'wget.exe': 'Wget',
  'powershell.exe': 'Windows PowerShell',
  'vs_setup_bootstrapper.exe': 'Visual Studio Installer',
  'vctip.exe': 'Visual C++ Telemetry',

  // Everyday apps
  'qbittorrent.exe': 'qBittorrent',
  'googledrivefs.exe': 'Google Drive',
  'telegram.exe': 'Telegram',
  'discord.exe': 'Discord',
  'zoom.exe': 'Zoom',
  'zotero.exe': 'Zotero',
  'obsidian.exe': 'Obsidian',
  'obs64.exe': 'OBS Studio',
  'bitwarden.exe': 'Bitwarden',
  'powertoys.exe': 'PowerToys',
  'music-vault.exe': 'Music Vault',

  // Microsoft Office / OneDrive
  'winword.exe': 'Word',
  'excel.exe': 'Excel',
  'powerpnt.exe': 'PowerPoint',
  'onenote.exe': 'OneNote',
  'sdxhelper.exe': 'Office Helper',
  'officec2rclient.exe': 'Office Click-to-Run',
  'officeclicktorun.exe': 'Office Click-to-Run',
  'onedrive.exe': 'OneDrive',
  'onedrivelauncher.exe': 'OneDrive Launcher',
  'onedrivestandaloneupdater.exe': 'OneDrive Updater',
  'onedrive.sync.service.exe': 'OneDrive Sync',
  'filecoauth.exe': 'OneDrive Co-authoring',

  // NVIDIA
  'nvcontainer.exe': 'NVIDIA Container',
  'nvidia app.exe': 'NVIDIA App',
  'nvidia overlay.exe': 'NVIDIA Overlay',
  'nvdisplay.container.exe': 'NVIDIA Display Container',
  'nvngx_update.exe': 'NVIDIA DLSS Update',

  // ASUS
  'asussoftwaremanager.exe': 'ASUS Software Manager',
  'asussoftwaremanageragent.exe': 'ASUS Software Manager Agent',
  'asusupdate.exe': 'ASUS Update',
  'asusverifyjwt.exe': 'ASUS Verify',

  // Windows components
  'explorer.exe': 'Windows Explorer',
  'searchapp.exe': 'Windows Search',
  'svchost.exe': 'Service Host',
  'taskhostw.exe': 'Windows Task Host',
  'wermgr.exe': 'Windows Error Reporting',
  'werfault.exe': 'Windows Error Reporting',
  'compattelrunner.exe': 'Windows Telemetry',
  'smartscreen.exe': 'Windows SmartScreen',
  'mousocoreworker.exe': 'Windows Update Orchestrator',
  'sihclient.exe': 'Windows Server-Initiated Healing',
  'apphostregistrationverifier.exe': 'App Host Verifier',
  'updater.exe': 'Google Updater',
};

/**
 * AppX package names, keyed by family name with the version stripped.
 *
 * Two entries are counter-intuitive and were verified against real data:
 *
 * - `OpenAI.Codex_*` is what Windows labels **ChatGPT**, not "Codex". Summing
 *   all installed versions gives exactly what Settings shows for ChatGPT. The
 *   separate `codex.exe` is the CLI -- a different program, though it now sits
 *   in the same family, see FAMILY_OF.
 * - The Claude desktop app's package is plain `Claude_…`, not
 *   `Anthropic.Claude_…` as first assumed.
 */
const APPX_KNOWN_NAMES: Record<string, string> = {
  'openai.codex': 'ChatGPT',
  'openai.chatgpt': 'ChatGPT',
  claude: 'Claude Desktop',
  'anthropic.claude': 'Claude Desktop',

  'microsoft.desktopappinstaller': 'App Installer',
  'microsoft.windowsstore': 'Microsoft Store',
  'microsoft.outlookforwindows': 'Outlook',
  msteams: 'Microsoft Teams',
  'microsoft.todos': 'Microsoft To Do',
  'microsoft.powershell': 'PowerShell 7',
  // Named in full because the phone reports a Google 'Photos' too, and the
  // colour and logo maps are keyed by display name.
  'microsoft.windows.photos': 'Microsoft Photos',
  'microsoft.yourphone': 'Phone Link',
  'microsoft.bingnews': 'Microsoft News',
  'microsoft.bingweather': 'MSN Weather',
  'microsoft.windowsfeedbackhub': 'Feedback Hub',
  'microsoft.commandpalette': 'Command Palette',
  'microsoft.lockapp': 'Lock Screen',
  'microsoft.startexperiencesapp': 'Start Experiences',
  'microsoft.microsoftofficehub': 'Office Hub',
  'microsoft.officepushnotificationutility': 'Office Notifications',
  'microsoft.office.actionsserver': 'Office Actions',
  'microsoft.gamingservices': 'Gaming Services',
  'microsoft.gamingapp': 'Xbox',
  'microsoft.xboxgamingoverlay': 'Xbox Game Bar',
  'microsoftcorporationii.quickassist': 'Quick Assist',
  'microsoftcorporationii.microsoftfamily': 'Microsoft Family Safety',
  'microsoftwindows.client.webexperience': 'Windows Widgets',
  'microsoftwindows.client.cbs': 'Windows Search',
  'microsoftwindows.client.oobe': 'Windows Setup',
  'microsoftwindows.crossdevice': 'Cross Device',
  'dolbylaboratories.dolbyaccess': 'Dolby Access',
  '5319275a.whatsappdesktop': 'WhatsApp',
  'b9eced6f.asuspcassistant': 'ASUS PC Assistant',
  'b9eced6f.armourycrate': 'Armoury Crate',
};

/**
 * Friendly names for services, keyed by the normalised service name.
 *
 * Windows service names are terse by design (`DoSvc`, `wlidsvc`); expanding
 * them is the difference between a table that reads and one that has to be
 * looked up.
 */
const SERVICE_KNOWN_NAMES: Record<string, string> = {
  googleupdaterservice: 'Google Updater',
  dosvc: 'Delivery Optimisation',
  bits: 'Background Transfer (BITS)',
  wuauserv: 'Windows Update',
  usosvc: 'Update Orchestrator',
  waasmedicsvc: 'Update Medic',
  installservice: 'Microsoft Store Install Service',
  diagtrack: 'Connected User Experiences',
  wlidsvc: 'Microsoft Account Sign-in',
  mdcoresvc: 'Microsoft Defender Core',
  windefend: 'Microsoft Defender Antivirus',
  cryptsvc: 'Cryptographic Services',
  dnscache: 'DNS Client',
  dhcp: 'DHCP Client',
  spooler: 'Print Spooler',
  ssdpsrv: 'SSDP Discovery',
  netprofm: 'Network List Service',
  lfsvc: 'Geolocation Service',
  wisvc: 'Windows Insider Service',
  licensemanager: 'Windows License Manager',
  appxsvc: 'AppX Deployment Service',
  xblauthmanager: 'Xbox Live Auth',
  wpnservice: 'Windows Push Notifications',
  wpnuserservice: 'Windows Push Notifications (user)',
  cdpsvc: 'Connected Devices Platform',
  cdpusersvc: 'Connected Devices Platform (user)',
  system: 'System',
  'rog live service': 'ROG Live Service',
  asusappservice: 'ASUS App Service',
  'windows.immersivecontrolpanel': 'Settings',
  'microsoft.windows.contentdeliverymanager': 'Content Delivery Manager',
  'microsoft.windows.cloudexperiencehost': 'Cloud Experience Host',
  'microsoft.windows.shellexperiencehost': 'Shell Experience Host',
  'microsoft.windows.startmenuexperiencehost': 'Start Menu',
  'microsoft.aad.brokerplugin': 'Work or School Account',
};

/* ------------------------------------------------------------------ */
/* Layer 2 -- families                                                 */
/* ------------------------------------------------------------------ */

/**
 * Member key -> family id.
 *
 * A family is "one product as a person thinks of it". The detail page lists
 * every member with its own total, so nothing is hidden by merging -- the
 * breakdown moves from the top-level table (where 400 rows of background
 * services drown the signal) to the page about that one product.
 *
 * Note the deliberate reversal of an earlier decision: `claude.exe` (the CLI)
 * and the `Claude` store app used to be kept apart on the grounds that they are
 * different programs. They are, and the detail page still says so -- but they
 * are one product, and the top-level table reads better for saying that too.
 */
const FAMILY_OF: Record<string, string> = {
  // Anthropic
  'claude.exe': 'claude',
  'appx:claude': 'claude',
  'appx:anthropic.claude': 'claude',
  'claude setup.exe': 'claude',

  // OpenAI
  'appx:openai.codex': 'chatgpt',
  'appx:openai.chatgpt': 'chatgpt',
  'codex.exe': 'chatgpt',
  'node_repl.exe': 'chatgpt',

  // Ollama
  'ollama.exe': 'ollama',
  'ollama app.exe': 'ollama',

  // Browsers
  'msedge.exe': 'edge',
  'msedgewebview2.exe': 'edge',
  'microsoftedgeupdate.exe': 'edge',
  'brave.exe': 'brave',
  'braveupdate.exe': 'brave',

  // Android
  'studio64.exe': 'android-studio',
  'netsimd.exe': 'android-emulator',
  'qemu-system-x86_64.exe': 'android-emulator',
  'qemu-system-x86_64-headless.exe': 'android-emulator',

  // Editors that ship several binaries
  'antigravity ide.exe': 'antigravity',
  'antigravity.exe': 'antigravity',
  'language_server_windows_x64.exe': 'antigravity',
  'language_server.exe': 'antigravity',

  // NVIDIA
  'nvcontainer.exe': 'nvidia',
  'nvidia app.exe': 'nvidia',
  'nvidia overlay.exe': 'nvidia',
  'nvdisplay.container.exe': 'nvidia',
  'nvngx_update.exe': 'nvidia',

  // OneDrive
  'onedrive.exe': 'onedrive',
  'onedrivelauncher.exe': 'onedrive',
  'onedrivestandaloneupdater.exe': 'onedrive',
  'onedrive.sync.service.exe': 'onedrive',
  'filecoauth.exe': 'onedrive',

  // Office
  'winword.exe': 'office',
  'excel.exe': 'office',
  'powerpnt.exe': 'office',
  'onenote.exe': 'office',
  'sdxhelper.exe': 'office',
  'officec2rclient.exe': 'office',
  'officeclicktorun.exe': 'office',
  'appx:microsoft.microsoftofficehub': 'office',
  'appx:microsoft.officepushnotificationutility': 'office',
  'appx:microsoft.office.actionsserver': 'office',

  // ASUS
  'asussoftwaremanager.exe': 'asus',
  'asussoftwaremanageragent.exe': 'asus',
  'asusupdate.exe': 'asus',
  'asusverifyjwt.exe': 'asus',
  'appx:b9eced6f.asuspcassistant': 'asus',
  'appx:b9eced6f.armourycrate': 'asus',
  'svc:asusappservice': 'asus',
  'svc:rog live service': 'asus',

  // GitHub
  'gh.exe': 'github',
  'github.exe': 'github',
  'githubdesktop.exe': 'github',

  // Apps whose installer is a separate binary
  'bitwarden.exe': 'bitwarden',
  'wispr flow.exe': 'wispr-flow',

  // Languages / runtimes
  'python.exe': 'python',
  'pythonw.exe': 'python',
  'java.exe': 'java',
  'javaw.exe': 'java',
  'cargo.exe': 'rust',
  'rustup-init.exe': 'rust',

  // Google
  'svc:googleupdaterservice': 'google-updater',
  'updater.exe': 'google-updater',

  // Windows groupings. `System and Windows Update` is Windows' own label,
  // verified against Settings: DoSvc + BITS together match its figure.
  'svc:dosvc': 'windows-update',
  'svc:bits': 'windows-update',
  'svc:wuauserv': 'windows-update',
  'svc:usosvc': 'windows-update',
  'svc:waasmedicsvc': 'windows-update',
  'svc:deliveryoptimization': 'windows-update',
  'mousocoreworker.exe': 'windows-update',
  'sihclient.exe': 'windows-update',

  'svc:windefend': 'windows-defender',
  'svc:mdcoresvc': 'windows-defender',
  'smartscreen.exe': 'windows-defender',

  'svc:wpnservice': 'windows-notifications',
  'svc:wpnuserservice': 'windows-notifications',

  'svc:cdpsvc': 'connected-devices',
  'svc:cdpusersvc': 'connected-devices',
  'appx:microsoftwindows.crossdevice': 'connected-devices',
  'appx:microsoft.yourphone': 'connected-devices',

  'wermgr.exe': 'windows-error-reporting',
  'werfault.exe': 'windows-error-reporting',

  'appx:microsoft.gamingservices': 'xbox',
  'appx:microsoft.gamingapp': 'xbox',
  'appx:microsoft.xboxgamingoverlay': 'xbox',
  'svc:xblauthmanager': 'xbox',

  'appx:msteams': 'teams',
  'appx:microsoft.outlookforwindows': 'outlook',

  // Windows PowerShell (the in-box 5.1) and PowerShell 7 (the store app) are
  // different products, but both are "PowerShell" to a person -- and leaving
  // them apart produced two groups with an identical label, which the colour
  // and logo maps key on.
  'powershell.exe': 'powershell',
  'appx:microsoft.powershell': 'powershell',

  'vs_setup_bootstrapper.exe': 'visual-studio',
  'vctip.exe': 'visual-studio',
};

/** Display name per family id. */
const FAMILY_NAMES: Record<string, string> = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  ollama: 'Ollama',
  edge: 'Microsoft Edge',
  brave: 'Brave',
  'android-studio': 'Android Studio',
  'android-emulator': 'Android Emulator',
  antigravity: 'Antigravity',
  nvidia: 'NVIDIA',
  onedrive: 'OneDrive',
  office: 'Microsoft Office',
  asus: 'ASUS',
  github: 'GitHub',
  python: 'Python',
  java: 'Java',
  rust: 'Rust',
  'google-updater': 'Google Updater',
  'windows-update': 'System and Windows Update',
  'windows-defender': 'Windows Defender',
  'windows-notifications': 'Windows Notifications',
  'connected-devices': 'Connected Devices',
  'windows-error-reporting': 'Windows Error Reporting',
  xbox: 'Xbox',
  teams: 'Microsoft Teams',
  outlook: 'Outlook',
  'visual-studio': 'Visual Studio',
  powershell: 'PowerShell',
  'wispr-flow': 'Wispr Flow',
  bitwarden: 'Bitwarden',
};

/* ------------------------------------------------------------------ */
/* Path shape helpers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Basenames that name a *task*, not a program.
 *
 * `setup.exe` is Visual Studio's installer in one path and NVIDIA's in
 * another; grouping them on the basename merges two unrelated things and
 * labels the result "setup.exe". These are keyed on their directory instead.
 */
const GENERIC_BASENAMES = new Set([
  'setup.exe', 'install.exe', 'installer.exe', 'uninstall.exe',
  'update.exe', 'main.exe', 'app.exe', 'launcher.exe', 'helper.exe',
  'service.exe', 'start.exe',
]);

/**
 * Vendor lookup for those, and for a handful of binaries whose basename is too
 * generic to identify. Tested against the whole NT path, first match wins, so
 * order is significance-ordered rather than alphabetical.
 */
const PATH_VENDORS: { test: RegExp; family: string; name: string }[] = [
  { test: /\\microsoft visual studio\\/, family: 'visual-studio', name: 'Visual Studio Installer' },
  { test: /\\nvidia\b/, family: 'nvidia', name: 'NVIDIA Installer' },
  { test: /\\wisprflow\\/, family: 'wispr-flow', name: 'Wispr Flow Updater' },
  { test: /\\githubdesktop\\/, family: 'github', name: 'GitHub Desktop Updater' },
  { test: /\\googleupdater\\/, family: 'google-updater', name: 'Google Updater' },
  { test: /\\bravesoftware\\/, family: 'brave', name: 'Brave Updater' },
  { test: /\\bitwarden-installer/, family: 'bitwarden', name: 'Bitwarden Installer' },
  { test: /\\openai\\codex\\/, family: 'chatgpt', name: 'Codex' },
];

/** Last path segment, for NT-namespace paths that use backslashes. */
function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : p;
}

/** Second-to-last segment, used to key generic basenames. */
function parentDir(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2]! : '';
}

/**
 * Strip the version from an AppX package full name.
 * `OpenAI.Codex_26.814.5517.0_x64__2p2nqsd0c76g0` -> `openai.codex`
 */
function appxPackageName(identity: string): string {
  const underscore = identity.indexOf('_');
  return (underscore > 0 ? identity.slice(0, underscore) : identity).toLowerCase();
}

/**
 * Service names carry two kinds of noise, both of which fragment one service
 * into many rows that each look smaller than the truth:
 *
 * - **A version.** `GoogleUpdaterService151.0.7910.0` and
 *   `GoogleUpdaterService152.0.7933.0` are one service. A dot in the trailing
 *   number is required so genuine names ending in a digit (`Tcpip6`, `Dhcp4`)
 *   are left alone.
 * - **A per-user-session suffix.** `WpnUserService_ca529`, `CDPUserSvc_b0b30`
 *   -- Windows spawns one instance per logon session, and the hex tail changes
 *   every boot. Left alone these produced ~100 single-row entries.
 * - **An AppX package tail.** Some services arrive as full package names, e.g.
 *   `windows.immersivecontrolpanel_10.0.8.1000_neutral_neutral_cw5n1h2txyewy`.
 */
const SERVICE_VERSION_SUFFIX = /\d+\.\d[\d.]*$/;
const SERVICE_SESSION_SUFFIX = /^([a-z][a-z0-9.]*?)_[0-9a-f]{4,}$/;
const SERVICE_PACKAGE_SUFFIX = /^(.+?)_\d[\d.]*_[a-z0-9]*_[a-z0-9]*_[a-z0-9]+$/;

function normaliseService(raw: string): string {
  let s = raw.replace(SERVICE_VERSION_SUFFIX, '');
  const pkg = SERVICE_PACKAGE_SUFFIX.exec(s);
  if (pkg) s = pkg[1]!;
  const session = SERVICE_SESSION_SUFFIX.exec(s.toLowerCase());
  if (session) s = session[1]!;
  return s;
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

interface Member {
  key: string;
  name: string;
  /** Set when the path itself, not the basename, identified the program. */
  family?: string;
}

function resolveMember(raw: string, kind: AppKind): Member {
  if (kind === 'path') {
    const base = basename(raw).toLowerCase();

    // A task name, not a program name: identify it by where it lives.
    if (GENERIC_BASENAMES.has(base)) {
      const vendor = PATH_VENDORS.find((v) => v.test.test(raw));
      if (vendor) return { key: `${vendor.family}:${base}`, name: vendor.name, family: vendor.family };
      // No vendor known -- key on the directory so two unrelated installers do
      // not merge into one row called "setup.exe".
      const dir = parentDir(raw).toLowerCase();
      return { key: dir ? `${dir}\\${base}` : base, name: basename(raw) };
    }

    // The vendor rule applies whether or not the basename is known. Skipping it
    // for known names split Bitwarden and Wispr Flow into two groups with the
    // SAME display name -- the app and its installer -- which reads as a bug.
    // FAMILY_OF still wins over it, in resolveApp.
    const vendor = PATH_VENDORS.find((v) => v.test.test(raw));
    return {
      key: base,
      name: KNOWN_EXE_NAMES[base] ?? basename(raw),
      family: vendor?.family,
    };
  }

  if (kind === 'appx') {
    const pkg = appxPackageName(raw);
    return {
      key: `appx:${pkg}`,
      name: APPX_KNOWN_NAMES[pkg] ?? pkg.split('.').pop() ?? pkg,
    };
  }

  // service
  const stripped = normaliseService(raw);
  const key = stripped.toLowerCase();
  return { key: `svc:${key}`, name: SERVICE_KNOWN_NAMES[key] ?? stripped };
}

export function resolveApp(identity: string, kind: AppKind): ResolvedApp {
  const raw = identity.trim();

  if (kind === 'aggregate') {
    const name = 'All traffic (interface total)';
    return {
      groupKey: '__aggregate__', displayName: name, kind,
      memberKey: '__aggregate__', memberName: name,
    };
  }

  if (raw === '' || kind === 'unknown') {
    return {
      groupKey: '__unknown__', displayName: 'Unattributed', kind,
      memberKey: '__unknown__', memberName: 'Unattributed',
    };
  }

  const member = resolveMember(raw, kind);
  const family = FAMILY_OF[member.key] ?? member.family;

  if (family) {
    return {
      groupKey: family,
      displayName: FAMILY_NAMES[family] ?? member.name,
      kind,
      memberKey: member.key,
      memberName: member.name,
    };
  }

  return {
    groupKey: member.key,
    displayName: member.name,
    kind,
    memberKey: member.key,
    memberName: member.name,
  };
}
