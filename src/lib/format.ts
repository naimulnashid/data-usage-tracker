/**
 * Formatting helpers.
 *
 * Every numeric string produced here is meant to be rendered with
 * `font-variant-numeric: tabular-nums` (applied globally in globals.css), so
 * digits keep a fixed width and nothing jitters during count-up animations.
 */

/** Binary units, matching what Windows' Data usage page reports. */
export function formatBytes(bytes: number, decimals?: number): string {
  const abs = Math.abs(bytes);
  if (abs < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes / 1024;
  let i = 0;
  while (Math.abs(value) >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const d = decimals ?? (Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2);
  return `${value.toFixed(d)} ${units[i]}`;
}

/** Split so the unit can be styled separately from the number. */
export function splitBytes(bytes: number): { value: string; unit: string } {
  const s = formatBytes(bytes);
  const idx = s.lastIndexOf(' ');
  return { value: s.slice(0, idx), unit: s.slice(idx + 1) };
}

export function formatPercent(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`;
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** "2026-08-21" -> "Aug 21" */
export function formatDayShort(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${d}`;
}

/**
 * An ISO instant -> the local calendar day it fell on: "2026-09-19".
 *
 * Not `instant.slice(0, 10)`, which is the UTC day. At UTC+6 that files
 * anything between midnight and 06:00 under the day before -- the phone
 * page's "collected over USB" date did exactly that. Local here means the
 * server's zone, which is right for an event that happened on this machine.
 */
export function localDayOf(instant: string): string {
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return instant.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-08-21" -> "Thursday, 21 August 2026" */
export function formatDayLong(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function formatRelative(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min ago`;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = hours / 24;
  if (days < 2) return 'yesterday';
  return `${Math.round(days)} days ago`;
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
