/**
 * Mapping from SrumECmd's NetworkUsages CSV to our row shape.
 *
 * Verified against SrumECmd 2026.5.0 on 2026-08-20.
 */

/** Columns as SrumECmd emits them, in file order. */
export const SRUM_COLUMNS = {
  id: 'Id',
  timestamp: 'Timestamp',
  exeInfo: 'ExeInfo',
  exeInfoDescription: 'ExeInfoDescription',
  exeTimestamp: 'ExeTimestamp',
  sidType: 'SidType',
  sid: 'Sid',
  userName: 'UserName',
  userId: 'UserId',
  appId: 'AppId',
  bytesReceived: 'BytesReceived',
  bytesSent: 'BytesSent',
  interfaceLuid: 'InterfaceLuid',
  interfaceType: 'InterfaceType',
  l2ProfileFlags: 'L2ProfileFlags',
  l2ProfileId: 'L2ProfileId',
  profileName: 'ProfileName',
} as const;

/** The subset we cannot proceed without. */
export const REQUIRED_COLUMNS = [
  SRUM_COLUMNS.timestamp,
  SRUM_COLUMNS.appId,
  SRUM_COLUMNS.exeInfo,
  SRUM_COLUMNS.bytesSent,
  SRUM_COLUMNS.bytesReceived,
  SRUM_COLUMNS.interfaceLuid,
  SRUM_COLUMNS.l2ProfileId,
  SRUM_COLUMNS.userId,
] as const;

/**
 * The aggregate AppId.
 *
 * app_id 1 is not an application. It is the per-interface total SRUM writes
 * each hour, equal to the sum of every named app in that hour. Measured over
 * 30 days, the two agree to 0.1%.
 */
export const AGGREGATE_APP_ID = 1;

export type AppKind = 'path' | 'appx' | 'service' | 'aggregate' | 'unknown';

export interface UsageRow {
  timestampUtc: string;
  localDate: string;
  localHour: number;
  appId: number;
  isAggregate: boolean;
  appIdentity: string;
  appKind: AppKind;
  userId: string;
  sid: string;
  interfaceLuid: string;
  interfaceType: string;
  l2ProfileId: string;
  profileName: string;
  bytesSent: number;
  bytesReceived: number;
}

/**
 * An AppX package full name: Name_Version_Arch__PublisherId
 * e.g. OpenAI.Codex_26.814.5517.0_x64__2p2nqsd0c76g0
 */
const APPX_FULL_NAME = /^[^\\/]+_\d+(?:\.\d+)*_(?:x64|x86|arm|arm64|neutral)__[a-z0-9]+$/i;

export function classifyApp(appId: number, identity: string): AppKind {
  if (appId === AGGREGATE_APP_ID) return 'aggregate';

  const s = identity.trim();
  if (s === '') return 'unknown';
  if (s.includes('\\') || s.includes('/')) return 'path';
  if (APPX_FULL_NAME.test(s)) return 'appx';

  // Everything left is a bare token: DoSvc, BITS, and friends.
  return 'service';
}

/**
 * SrumECmd emits UTC. Confirmed on 2026-08-20: the newest row (16:20) lagged
 * the snapshot (22:37 local) by exactly the machine's UTC+6 offset.
 *
 * Accepts "2026-07-22 03:05:00" and ISO-ish variants. Returns null on garbage
 * rather than silently producing an Invalid Date that poisons the local_date.
 */
export function parseSrumTimestamp(raw: string): Date | null {
  const s = raw.trim();
  if (s === '') return null;

  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) {
    const fallback = new Date(s.endsWith('Z') ? s : s + 'Z');
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  const [, y, mo, d, h, mi, sec] = m;
  const date = new Date(
    Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +sec!),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Local-time day/hour buckets.
 *
 * Deliberately uses the machine's local timezone, not UTC. Grouping the raw
 * UTC timestamps into "days" would shift every daily total by the UTC offset
 * (6h here), filing early-morning traffic under the previous day.
 */
export function toLocalBuckets(utc: Date): { localDate: string; localHour: number } {
  const y = utc.getFullYear();
  const m = String(utc.getMonth() + 1).padStart(2, '0');
  const d = String(utc.getDate()).padStart(2, '0');
  return { localDate: `${y}-${m}-${d}`, localHour: utc.getHours() };
}

/** Tolerant integer parse: SRUM byte fields are plain digits, but be safe. */
function toInt(raw: string | undefined): number {
  if (raw == null) return 0;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Map one CSV record. Returns null for rows with an unparseable timestamp,
 * which the caller counts and reports rather than dropping silently.
 */
export function mapRow(rec: Record<string, string>): UsageRow | null {
  const utc = parseSrumTimestamp(rec[SRUM_COLUMNS.timestamp] ?? '');
  if (!utc) return null;

  const appId = toInt(rec[SRUM_COLUMNS.appId]);
  const identity = (rec[SRUM_COLUMNS.exeInfo] ?? '').trim();
  const { localDate, localHour } = toLocalBuckets(utc);

  return {
    timestampUtc: utc.toISOString(),
    localDate,
    localHour,
    appId,
    isAggregate: appId === AGGREGATE_APP_ID,
    appIdentity: identity,
    appKind: classifyApp(appId, identity),
    userId: (rec[SRUM_COLUMNS.userId] ?? '').trim(),
    sid: (rec[SRUM_COLUMNS.sid] ?? '').trim(),
    // TEXT throughout: LUIDs exceed 2^53 and must never become JS numbers.
    interfaceLuid: (rec[SRUM_COLUMNS.interfaceLuid] ?? '').trim(),
    interfaceType: (rec[SRUM_COLUMNS.interfaceType] ?? '').trim(),
    l2ProfileId: (rec[SRUM_COLUMNS.l2ProfileId] ?? '').trim(),
    profileName: (rec[SRUM_COLUMNS.profileName] ?? '').trim(),
    bytesSent: toInt(rec[SRUM_COLUMNS.bytesSent]),
    bytesReceived: toInt(rec[SRUM_COLUMNS.bytesReceived]),
  };
}
