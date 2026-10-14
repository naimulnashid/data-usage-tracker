/*
  The project site's only script. It runs in <head>, so the theme is set
  before first paint, then draws the chart gallery once the DOM exists.

  Every chart is generated from a fixed seed: identical on every load, and
  nobody's usage. The shapes, colours and rules (spike threshold, upload
  tint, heat-map ramp, null days as breaks) follow the dashboard's own
  src/components/Charts.tsx, ActivityHeatmap.tsx and src/lib/app-colors.ts.
*/

/* ------------------------------------------------------------------ theme */

const THEME_KEY = 'dut-site-theme';

function systemTheme() {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function storedTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : null;
  } catch { return null; }
}

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'light' ? '#f4f5f7' : '#000000');
}

applyTheme(storedTheme() ?? systemTheme());

/* ------------------------------------------------------------------ data */

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GB = 1;
const END = new Date(Date.UTC(2026, 8, 30)); // 2026-09-30, the screenshots' last day
const DAY_MS = 86400000;

function dayAt(i, n) { return new Date(END.getTime() - (n - 1 - i) * DAY_MS); }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDay = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
const fmtDayLong = (d) => `${WEEKDAYS[d.getUTCDay()]}, ${fmtDay(d)}`;

/** Gigabytes -> the dashboard's compact unit: three significant figures. */
function fmt(gb, parts) {
  let v = gb, u = 'GB';
  if (gb >= 1000) { v = gb / 1000; u = 'TB'; }
  else if (gb < 1) { v = gb * 1000; u = 'MB'; }
  if (v < 1 && u === 'MB') { v = v * 1000; u = 'KB'; }
  const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return parts ? [s, u] : `${s} ${u}`;
}
const pct = (x) => `${(x * 100).toFixed(1)}%`;

/*
  Two invented devices. App colours are the dashboard's BRAND entries;
  "Other" is its OTHER_COLOR. kind marks the table's badges.
*/
const DEVICES = {
  windows: {
    days: 100,
    seed: 20260923,
    upShare: 0.16,
    apps: [
      { name: 'qBittorrent', color: '#2F6790', w: 1.1, burst: 0.12, burstSize: 14 },
      { name: 'Microsoft Edge', color: '#0078D7', w: 1.4 },
      { name: 'Google Drive', color: '#FFBA00', w: 0.45, up: 0.45 },
      { name: 'Microsoft Teams', color: '#6264A7', w: 0.35, up: 0.35, kind: 'store' },
      { name: 'Chrome', color: '#4285F4', w: 0.22 },
      { name: 'Node.js', color: '#68A063', w: 0.2 },
      { name: 'Discord', color: '#5865F2', w: 0.15, up: 0.2 },
      { name: 'VS Code', color: '#007ACC', w: 0.12 },
      { name: 'System and Windows Update', color: '#0067B8', w: 0.11, kind: 'service', burst: 0.05, burstSize: 2 },
      { name: 'Zoom', color: '#2D8CFF', w: 0.07, up: 0.4 },
      { name: 'Telegram', color: '#24A1DE', w: 0.06 },
      { name: 'Git', color: '#F1502F', w: 0.02 },
    ],
    gap: [44, 45, 46],
    hourShape: [3, 3, 3, 2.6, 3, 2.8, 0, 0, 0.4, 1.3, 2.6, 2.7, 2.4, 1.6, 1.5, 1.6, 1.3, 1.3, 0.9, 2.2, 3.4, 4.3, 3.6, 4],
    bucket: 1,
    split: ['Wi-Fi', 'Wired'],
    networks: [
      { name: 'HomeNet-5G', alias: 1, share: 0.952 },
      { name: 'Corner Café Guest', share: 0.044 },
      { name: 'Wi-Fi, unnamed', share: 0.004, muted: true },
    ],
    wifiShare: 0.93,
    detailApp: 'Microsoft Edge',
  },
  android: {
    days: 90,
    seed: 20260930,
    upShare: 0.06,
    apps: [
      { name: 'YouTube', color: '#FF0000', w: 0.55 },
      { name: 'Netflix', color: '#E50914', w: 0.22, burst: 0.08, burstSize: 1.4 },
      { name: 'Instagram', color: '#E4405F', w: 0.16 },
      { name: 'Google Play Store', color: '#01875F', w: 0.08, burst: 0.06, burstSize: 0.8 },
      { name: 'Chrome', color: '#4285F4', w: 0.07 },
      { name: 'WhatsApp', color: '#25D366', w: 0.05, up: 0.35 },
      { name: 'Spotify', color: '#1DB954', w: 0.04 },
      { name: 'Google Play services', color: '#4285F4', w: 0.03, kind: 'system' },
      { name: 'Telegram', color: '#24A1DE', w: 0.02 },
      { name: 'Maps', color: '#34A853', w: 0.015 },
    ],
    gap: [],
    hourShape: [1, 1, 1, 0.3, 1.6, 1.4, 2.6, 1.3, 1.5, 3.4, 7.2, 7.0],
    bucket: 2,
    split: ['Wi-Fi', 'Mobile data'],
    networks: [
      { name: 'HomeNet-5G', share: 0.91 },
      { name: 'Corner Café Guest', share: 0.04 },
      { name: 'Over a VPN', share: 0.05, muted: true },
    ],
    wifiShare: 0.73,
    tethered: 0.931,
    detailApp: 'YouTube',
  },
};

function build(device) {
  const cfg = DEVICES[device];
  const rnd = mulberry32(cfg.seed);
  const n = cfg.days;
  const perApp = cfg.apps.map(() => []);
  const days = [];
  const scale = device === 'windows' ? 1 : 0.32;
  for (let i = 0; i < n; i++) {
    const date = dayAt(i, n);
    if (cfg.gap.includes(i)) {
      cfg.apps.forEach((_, a) => perApp[a].push(null));
      days.push({ date, total: null, rx: null, tx: null });
      continue;
    }
    const weekend = date.getUTCDay() === 5 || date.getUTCDay() === 6 ? 1.25 : 1;
    let total = 0, tx = 0;
    cfg.apps.forEach((app, a) => {
      let v = app.w * scale * weekend * (0.35 + rnd() * 1.3);
      if (app.burst && rnd() < app.burst) v += app.burstSize * scale * (0.6 + rnd() * 0.8);
      if (rnd() < 0.04) v *= 0.1;
      perApp[a].push(v);
      total += v;
      tx += v * (app.up ?? cfg.upShare);
    });
    days.push({ date, total: total * 1.002, rx: total - tx, tx });
  }
  const appTotals = cfg.apps.map((app, a) => {
    const vals = perApp[a].filter((v) => v !== null);
    const total = vals.reduce((s, v) => s + v, 0);
    const up = app.up ?? cfg.upShare;
    return { ...app, total, tx: total * up, rx: total * (1 - up), rows: Math.round(vals.length * (6 + rnd() * 26)), series: perApp[a] };
  }).sort((a, b) => b.total - a.total);
  return { cfg, days, apps: appTotals, attributed: appTotals.reduce((s, a) => s + a.total, 0) };
}

const DATA = { windows: build('windows'), android: build('android') };

/* ------------------------------------------------------------------ colour */

const SUPPORTS_RELATIVE = typeof CSS !== 'undefined' && CSS.supports('color', 'oklch(from #123456 l c h)');

/** The dashboard's ink(): an app colour clamped to the theme's lightness band. */
function ink(hex) {
  return SUPPORTS_RELATIVE ? `oklch(from ${hex} clamp(var(--ink-lo, 0), l, var(--ink-hi, 1)) c h)` : hex;
}

function lab(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

function blend(hex, keep, target) {
  const ch = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * keep + target * (1 - keep)));
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** uploadTint(): darken a pale colour, lighten the rest, so the split always shows. */
const uploadTint = (hex) => (lab(hex) > 76 ? blend(hex, 0.62, 0) : blend(hex, 0.72, 255));
const OTHER = '#4b4b55';
const EVERYTHING_ELSE = '#C9C9D3';

const HEAT = {
  dark: {
    windows: ['#131519', '#12325c', '#17488a', '#1f62bd', '#2f80ed', '#6fb0ff'],
    android: ['#131519', '#0d3a24', '#125234', '#1a7b4c', '#3ddc84', '#8af0b8'],
  },
  light: {
    windows: ['#e1e6ed', '#c7dcf8', '#94bdf2', '#5b99e8', '#2a74dc', '#1252b0'],
    android: ['#e1e6ed', '#c3ead3', '#8dd6ad', '#4dba80', '#1f9457', '#0d6b3c'],
  },
};

/* ------------------------------------------------------------------ helpers */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** A top for a four-tick axis whose ticks are round: steps of 1, 2, 2.5 or 5. */
function niceMax(v) {
  const raw = v / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p * 4;
  return 40 * p;
}

function yAxis(max, x0, x1, y0, y1, ticks = 4) {
  let s = '';
  for (let i = 0; i <= ticks; i++) {
    const v = (max * i) / ticks;
    const y = y1 - ((y1 - y0) * i) / ticks;
    s += `<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" stroke="var(--grid)" />`;
    s += `<text x="${x0 - 8}" y="${y + 4}" text-anchor="end">${i === 0 ? '0 B' : esc(fmt(v))}</text>`;
  }
  return s;
}

function xDates(days, x, y, every) {
  let s = '';
  days.forEach((d, i) => {
    if (i % every === every - 1) s += `<text x="${x(i)}" y="${y}" text-anchor="middle">${fmtDay(d.date)}</text>`;
  });
  return s;
}

function tipRow(color, label, value) {
  return `<div class="row"><i style="background:${color}"></i>${esc(label)} <span style="margin-left:auto;padding-left:10px">${esc(value)}</span></div>`;
}

function callout(label, date, value) {
  return `<div class="chart-top"><div class="callout"><span class="callout-label">${label}</span><span class="callout-date">${esc(date)}</span><div class="callout-value">${esc(value)}</div></div></div>`;
}

/* ------------------------------------------------------------------ charts */

function drawStats(d) {
  const sum = (arr) => arr.reduce((a, x) => ({ total: a.total + (x.total ?? 0), rx: a.rx + (x.rx ?? 0), tx: a.tx + (x.tx ?? 0) }), { total: 0, rx: 0, tx: 0 });
  const k = d.days.length;
  const cards = [
    ['All', sum(d.days), `${fmtDay(d.days[0].date)} to ${fmtDay(d.days[k - 1].date)} · ${k} days`],
    ['Last 30 days', sum(d.days.slice(-30))],
    ['Last 7 days', sum(d.days.slice(-7))],
    ['Latest day', sum(d.days.slice(-1))],
  ];
  document.getElementById('v-stats').innerHTML = cards.map(([label, t, foot]) => {
    const [num, unit] = fmt(t.total, true);
    return `<div class="stat"><div class="stat-label">${label}</div>
      <div class="stat-value"><span data-count="${num}">${num}</span><small>${unit}</small></div>
      <div class="stat-sub">↑ ${fmt(t.tx)} &nbsp; ↓ ${fmt(t.rx)}</div>
      ${foot ? `<div class="stat-sub" style="color:var(--text-faint);font-size:12px">${esc(foot)}</div>` : ''}</div>`;
  }).join('');
  countUp(document.querySelectorAll('#v-stats [data-count]'));
}

function countUp(nodes) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  nodes.forEach((el) => {
    const target = el.dataset.count;
    const dec = (target.split('.')[1] || '').length;
    const to = parseFloat(target);
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 900);
      const e = 1 - (1 - p) ** 3;
      el.textContent = (to * e).toFixed(dec);
      if (p < 1) requestAnimationFrame(step); else el.textContent = target;
    };
    requestAnimationFrame(step);
  });
}

/** Monotone cubic (Fritsch-Carlson) through points, as Recharts draws type="monotone". */
function curve(pts, move = true) {
  const n = pts.length;
  if (n < 2) return pts.length ? `${move ? 'M' : 'L'}${pts[0][0]},${pts[0][1]}` : '';
  const dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b;
    if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  const f = (v) => v.toFixed(1);
  let d = `${move ? 'M' : 'L'}${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${f(pts[i][0] + h)},${f(pts[i][1] + h * t[i])} ${f(pts[i + 1][0] - h)},${f(pts[i + 1][1] - h * t[i + 1])} ${f(pts[i + 1][0])},${f(pts[i + 1][1])}`;
  }
  return d;
}

/** Splits an index range into runs of non-null days: each run is one path. */
function runs(days) {
  const out = []; let cur = [];
  days.forEach((d, i) => { if (d.total === null) { if (cur.length) out.push(cur); cur = []; } else cur.push(i); });
  if (cur.length) out.push(cur);
  return out;
}

function drawTrend(d) {
  const W = 1000, H = 270, L = 56, R = 8, T = 10, B = 26;
  const days = d.days;
  const known = days.filter((x) => x.total !== null);
  const mean = known.reduce((s, x) => s + x.total, 0) / known.filter((x) => x.total > 0).length;
  const spikeAt = mean * 2.5;
  const max = niceMax(Math.max(...known.map((x) => x.total)) * 1.05);
  const x = (i) => L + ((W - L - R) * i) / (days.length - 1);
  const y = (v) => H - B - ((H - B - T) * v) / max;
  const peak = known.reduce((a, b) => (b.total > a.total ? b : a));

  let paths = '';
  for (const run of runs(days)) {
    const line = curve(run.map((i) => [x(i), y(days[i].total)]));
    const area = `${line}L${x(run[run.length - 1]).toFixed(1)},${y(0)}L${x(run[0]).toFixed(1)},${y(0)}Z`;
    paths += `<path d="${area}" fill="url(#g-trend)" class="fade"/><path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" class="fade"/>`;
  }
  const gapRuns = days.map((dd, i) => (dd.total === null ? i : -1)).filter((i) => i >= 0);
  let gap = '';
  if (gapRuns.length) {
    const gx0 = x(gapRuns[0] - 1), gx1 = x(gapRuns[gapRuns.length - 1] + 1);
    gap = `<rect x="${gx0}" y="${T}" width="${gx1 - gx0}" height="${H - B - T}" fill="var(--grid)" opacity="0.5"/>
      <text x="${(gx0 + gx1) / 2}" y="${T + 14}" text-anchor="middle">not collected</text>`;
  }
  const spikes = days.map((dd, i) => (dd.total !== null && dd.total > spikeAt ? `<circle cx="${x(i)}" cy="${y(dd.total)}" r="4" fill="var(--danger)" class="fade"/>` : '')).join('');
  const hits = days.map((dd, i) => {
    const tip = dd.total === null
      ? `<b>${fmtDayLong(dd.date)}</b>No data collected`
      : `<b>${fmtDayLong(dd.date)}</b><span style="color:${dd.total > spikeAt ? 'var(--danger)' : 'var(--accent-bright)'};font-weight:650;font-size:15px">${fmt(dd.total)}</span>${dd.total > spikeAt ? ' <small>above trend</small>' : ''}`;
    const w = (W - L - R) / (days.length - 1);
    return `<rect x="${x(i) - w / 2}" y="${T}" width="${w}" height="${H - B - T}" fill="transparent" data-tip="${esc(tip)}"/>`;
  }).join('');

  document.getElementById('v-trend').innerHTML =
    callout('Heaviest day', fmtDay(peak.date), fmt(peak.total)) +
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily total over ${days.length} days, heaviest ${fmtDay(peak.date)} at ${fmt(peak.total)}">
      <defs><linearGradient id="g-trend" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="var(--accent)" stop-opacity="0.35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/>
      </linearGradient></defs>
      ${yAxis(max, L, W - R, T, H - B)}${gap}${paths}${spikes}${xDates(days, x, H - 6, 10)}${hits}
    </svg>`;
}

function topN(d, n) {
  const top = d.apps.slice(0, n);
  const rest = d.apps.slice(n);
  return { top, rest };
}

function drawStack(d) {
  const W = 1000, H = 270, L = 56, R = 8, T = 10, B = 26;
  const { top, rest } = topN(d, 8);
  const days = d.days;
  const series = [...top.map((a) => ({ name: a.name, color: ink(a.color), vals: a.series }))];
  series.push({ name: 'Other', color: OTHER, vals: days.map((_, i) => rest.reduce((s, a) => (a.series[i] === null ? null : (s ?? 0) + a.series[i]), 0)) });
  const totals = days.map((_, i) => (days[i].total === null ? null : series.reduce((s, se) => s + (se.vals[i] ?? 0), 0)));
  const max = niceMax(Math.max(...totals.filter((v) => v !== null)) * 1.05);
  const x = (i) => L + ((W - L - R) * i) / (days.length - 1);
  const y = (v) => H - B - ((H - B - T) * v) / max;

  let layers = '';
  for (const run of runs(days)) {
    const base = run.map(() => 0);
    series.forEach((se) => {
      const topv = run.map((i, k) => base[k] + (se.vals[i] ?? 0));
      const up = curve(run.map((i, k) => [x(i), y(topv[k])]));
      const down = curve(run.map((i, k) => [x(i), y(base[k])]).reverse(), false);
      layers += `<path d="${up}${down}Z" fill="${se.color}" fill-opacity="0.85" stroke="${se.color}" stroke-width="1" class="fade"/>`;
      topv.forEach((v, k) => (base[k] = v));
    });
  }
  const w = (W - L - R) / (days.length - 1);
  const hits = days.map((dd, i) => {
    const tip = dd.total === null ? `<b>${fmtDayLong(dd.date)}</b>No data collected`
      : `<b>${fmtDayLong(dd.date)}</b>` + series.slice().map((se) => [se, se.vals[i] ?? 0]).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([se, v]) => tipRow(se.color, se.name, fmt(v))).join('');
    return `<rect x="${x(i) - w / 2}" y="${T}" width="${w}" height="${H - B - T}" fill="transparent" data-tip="${esc(tip)}"/>`;
  }).join('');
  document.getElementById('v-stack').innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily usage by app, eight largest apps stacked with the rest as Other">
      ${yAxis(max, L, W - R, T, H - B)}${layers}${xDates(days, x, H - 6, 10)}${hits}</svg>`;
  document.getElementById('v-stack-legend').innerHTML =
    series.map((se) => `<span><i style="background:${se.color}"></i>${esc(se.name)}</span>`).join('');
}

function drawHour(d) {
  const W = 520, H = 250, L = 50, R = 6, T = 8, B = 24;
  const cfg = d.cfg;
  const n = cfg.hourShape.length;
  const total = d.days.reduce((s, x) => s + (x.total ?? 0), 0);
  const shapeSum = cfg.hourShape.reduce((s, v) => s + v, 0);
  const vals = cfg.hourShape.map((v) => (total * v) / shapeSum);
  const max = niceMax(Math.max(...vals) * 1.05);
  const slot = (W - L - R) / n;
  const bw = slot * 0.72;
  const y = (v) => H - B - ((H - B - T) * v) / max;
  const label = (h) => (cfg.bucket === 2 ? `${String(h * 2).padStart(2, '0')}:00-${String(h * 2 + 2).padStart(2, '0')}:00` : `${String(h).padStart(2, '0')}:00`);
  let bars = '';
  vals.forEach((v, h) => {
    if (v === 0) return;
    const bx = L + slot * h + (slot - bw) / 2;
    const tx = v * cfg.upShare, rx = v - tx;
    const tip = `<b>${label(h)}</b>${tipRow('var(--down)', 'Download', fmt(rx))}${tipRow('var(--up)', 'Upload', fmt(tx))}`;
    bars += `<g class="draw" style="animation-delay:${h * 25}ms" data-tip="${esc(tip)}">
      <rect x="${bx}" y="${y(rx)}" width="${bw}" height="${y(0) - y(rx)}" fill="var(--down)"/>
      <rect x="${bx}" y="${y(v)}" width="${bw}" height="${y(rx) - y(v)}" fill="var(--up)" rx="3"/></g>`;
  });
  const ticks = vals.map((_, h) => `<text x="${L + slot * h + slot / 2}" y="${H - 6}" text-anchor="middle">${String(h * cfg.bucket).padStart(2, '0')}</text>`).join('');
  const busiest = vals.indexOf(Math.max(...vals));
  document.getElementById('v-hour').innerHTML =
    callout('Busiest hour', label(busiest), fmt(vals[busiest])) +
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Usage by hour of day, busiest ${label(busiest)}">${yAxis(max, L, W - R, T, H - B)}${bars}${ticks}</svg>
    <div class="legend"><span><i style="background:var(--down)"></i>Download</span><span><i style="background:var(--up)"></i>Upload</span></div>`;
}

function drawTop(d) {
  const W = 520, L = 130, R = 14, rowH = 30, T = 4;
  const apps = d.apps.slice(0, 10);
  const H = T + apps.length * rowH + 24;
  const max = niceMax(apps[0].total * 1.04);
  const x = (v) => L + ((W - L - R) * v) / max;
  let s = '';
  for (let i = 0; i <= 4; i++) {
    const gx = L + ((W - L - R) * i) / 4;
    s += `<line x1="${gx}" x2="${gx}" y1="${T}" y2="${H - 22}" stroke="var(--grid)"/>`;
    s += `<text x="${gx}" y="${H - 6}" text-anchor="middle">${i === 0 ? '0 B' : fmt((max * i) / 4)}</text>`;
  }
  apps.forEach((a, i) => {
    const by = T + i * rowH + 5;
    const bh = rowH - 10;
    const name = a.name.length > 18 ? a.name.slice(0, 17) + '…' : a.name;
    const tip = `<b>${esc(a.name)}</b>${tipRow(ink(a.color), 'Download', fmt(a.rx))}${tipRow(ink(uploadTint(a.color)), 'Upload', fmt(a.tx))}<div style="margin-top:4px;color:var(--text-faint)">Click to open its detail page</div>`;
    s += `<text x="${L - 8}" y="${by + bh / 2 + 4}" text-anchor="end">${esc(name)}</text>`;
    s += `<g class="draw-x" style="animation-delay:${i * 40}ms;cursor:pointer" data-tip="${esc(tip)}" data-open="detail">
      <rect x="${L}" y="${by}" width="${x(a.rx) - L}" height="${bh}" fill="${ink(a.color)}"/>
      <rect x="${x(a.rx)}" y="${by}" width="${Math.max(2, x(a.total) - x(a.rx))}" height="${bh}" fill="${ink(uploadTint(a.color))}" rx="4"/></g>`;
  });
  document.getElementById('v-top').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Top 10 apps by total traffic, download and upload stacked">${s}</svg>`;
}

function drawAppDay(d) {
  const W = 520, H = 250, L = 50, R = 6, T = 8, B = 24;
  const app = d.apps.find((a) => a.name === d.cfg.detailApp);
  const up = app.up ?? d.cfg.upShare;
  const vals = app.series.slice(-60);
  const days = d.days.slice(-60);
  const max = niceMax(Math.max(...vals.filter((v) => v !== null)) * 1.05);
  const slot = (W - L - R) / vals.length;
  const bw = Math.max(2, slot * 0.7);
  const y = (v) => H - B - ((H - B - T) * v) / max;
  let bars = '';
  vals.forEach((v, i) => {
    if (v === null) return;
    const bx = L + slot * i + (slot - bw) / 2;
    const tx = v * up, rx = v - tx;
    const tip = `<b>${fmtDayLong(days[i].date)}</b>${tipRow('var(--down)', 'Download', fmt(rx))}${tipRow('var(--up)', 'Upload', fmt(tx))}`;
    bars += `<g class="draw" style="animation-delay:${i * 8}ms" data-tip="${esc(tip)}">
      <rect x="${bx}" y="${y(rx)}" width="${bw}" height="${y(0) - y(rx)}" fill="var(--down)"/>
      <rect x="${bx}" y="${y(v)}" width="${bw}" height="${y(rx) - y(v)}" fill="var(--up)" rx="1.5"/></g>`;
  });
  const xd = (i) => L + slot * i + slot / 2;
  const peakI = vals.reduce((b, v, i) => ((v ?? 0) > (vals[b] ?? 0) ? i : b), 0);
  document.getElementById('v-appday').innerHTML =
    callout('Heaviest day', fmtDay(days[peakI].date), fmt(vals[peakI])) +
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(app.name)}, daily usage over 60 days">${yAxis(max, L, W - R, T, H - B)}${bars}${xDates(days, xd, H - 6, 12)}</svg>
    <div class="legend"><span><i style="background:var(--down)"></i>Download</span><span><i style="background:var(--up)"></i>Upload</span></div>`;
}

function drawHeat(d, expanded) {
  const theme = document.documentElement.dataset.theme;
  const ramp = HEAT[theme][d.cfg === DEVICES.windows ? 'windows' : 'android'];
  const byDate = new Map(d.days.map((x) => [x.date.getTime(), x.total]));
  const first = d.days[0].date.getTime();
  const max = Math.max(...d.days.map((x) => x.total ?? 0));
  const step = (v) => (v <= max * 0.02 ? 0 : Math.min(5, 1 + Math.floor((v / max) * 5)));

  // Weeks run Saturday to Friday; the last column holds the latest day.
  const endDow = (END.getUTCDay() + 1) % 7; // Sat=0
  const lastSat = END.getTime() - endDow * DAY_MS;

  function block(startSat, hideBefore, label) {
    let cells = '<span></span>';
    let lastMonth = -1;
    for (let w = 0; w < 26; w++) {
      const m = new Date(startSat + w * 7 * DAY_MS).getUTCMonth();
      cells += `<span class="hm-month">${m !== lastMonth ? MONTHS[m] : ''}</span>`;
      lastMonth = m;
    }
    ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].forEach((name, dow) => {
      cells += `<span class="hm-day">${name}</span>`;
      for (let w = 0; w < 26; w++) {
        const t = startSat + (w * 7 + dow) * DAY_MS;
        const date = new Date(t);
        const v = byDate.get(t);
        if (t > END.getTime() || t < hideBefore) cells += '<span></span>';
        else if (t < first || v === null || v === undefined) {
          cells += `<span class="hm-cell hm-none" data-tip="${esc(`<b>${fmtDayLong(date)}</b>No data collected`)}"></span>`;
        } else {
          cells += `<span class="hm-cell fade" style="background:${ramp[step(v)]}" data-tip="${esc(`<b>${fmtDayLong(date)}</b>${fmt(v)}`)}"></span>`;
        }
      }
    });
    return (label ? `<div class="hm-block-label">${label}</div>` : '')
      + `<div class="hm" role="img" aria-label="Activity heat map, ${label || 'the last 26 weeks'}">${cells}</div>`;
  }

  let html;
  if (!expanded) {
    html = block(lastSat - 25 * 7 * DAY_MS, 0, '');
  } else {
    // From EXPANDED_FROM (Jan 1) in 26-week blocks, oldest first.
    const from = Date.UTC(2026, 0, 1);
    const fromSat = from - ((new Date(from).getUTCDay() + 1) % 7) * DAY_MS;
    html = '';
    for (let s0 = fromSat; s0 <= END.getTime(); s0 += 26 * 7 * DAY_MS) {
      const a = new Date(Math.max(s0, from));
      const b = new Date(Math.min(s0 + (26 * 7 - 1) * DAY_MS, END.getTime()));
      html += block(s0, from, `${fmtDay(a)} to ${fmtDay(b)}, 2026`);
    }
  }
  const total = d.days.reduce((s, x) => s + (x.total ?? 0), 0);
  const active = d.days.filter((x) => (x.total ?? 0) > 0).length;
  html += `<div class="hm-foot"><span>${fmt(total)} across ${active} active days</span>
    <button type="button" class="mini-btn" id="hm-toggle" aria-expanded="${expanded}">${expanded ? 'Back to 26 weeks' : 'Expand'}</button>
    <span class="hm-scale">Less <i class="none" title="No data collected"></i>${ramp.map((c) => `<i style="background:${c}"></i>`).join('')} More</span></div>`;
  const el = document.getElementById('v-heat');
  el.innerHTML = html;
  el.querySelector('#hm-toggle').addEventListener('click', () => drawHeat(d, !expanded));
}

function drawSplit() {
  const d = DATA.windows;
  const heavy = d.apps.find((a) => a.name === 'qBittorrent');
  const rest = d.attributed - heavy.total;
  const share = heavy.total / d.attributed;
  const [hv, hu] = fmt(heavy.total, true), [rv, ru] = fmt(rest, true);
  document.getElementById('v-split').innerHTML = `
    <div class="split-bar" role="img" aria-label="qBittorrent ${pct(share)}, everything else ${pct(1 - share)}">
      <span style="width:${share * 100}%;background:${ink(heavy.color)}"></span>
      <span style="width:${(1 - share) * 100}%;background:${EVERYTHING_ELSE};animation-delay:150ms"></span></div>
    <div class="halves">
      <div><div class="half-label"><i style="background:${ink(heavy.color)}"></i>qBittorrent</div>
        <div class="half-value" style="color:${ink(heavy.color)}">${hv}<small>${hu}</small></div><div class="half-sub">${pct(share)} of named traffic</div></div>
      <div><div class="half-label"><i style="background:${EVERYTHING_ELSE}"></i>Everything else</div>
        <div class="half-value">${rv}<small>${ru}</small></div><div class="half-sub">${pct(1 - share)} of named traffic</div></div>
    </div>`;
}

function drawWhere(d, device) {
  const total = d.days.reduce((s, x) => s + (x.total ?? 0), 0);
  const wifi = total * d.cfg.wifiShare, other = total - wifi;
  const [a, b] = d.cfg.split;
  const nets = d.cfg.networks;
  const top = Math.max(...nets.map((n) => n.share));
  const rows = nets.map((n, i) => `<div class="netrow"><span class="n ${n.muted ? 'unnamed' : ''}" title="${esc(n.name)}">${esc(n.name)}${n.alias ? ` <small style="color:var(--text-faint)">+${n.alias}</small>` : ''}</span>
      <span class="v" ${n.muted && device === 'android' ? 'style="color:var(--text-faint)"' : ''}>${fmt(wifi * n.share)}</span>
      <span class="bar-track"><span class="bar-fill" style="display:block;width:${(n.share / top) * 100}%;background:${n.muted && device === 'android' ? 'var(--text-faint)' : 'var(--accent)'};animation-delay:${i * 80}ms"></span></span></div>`).join('');
  const note = device === 'android'
    ? `<p class="half-sub" style="margin:12px 0 0">Tethering kept apart: ${fmt(d.cfg.tethered)} relayed for other devices is excluded from every figure on the phone's pages, because a laptop tethered to it has already counted those bytes.</p>`
    : `<p class="half-sub" style="margin:12px 0 0">Windows' own Data usage page shows one network at a time, so its figure matches one row here rather than the total.</p>`;
  document.getElementById('v-where').innerHTML = `
    <div class="split-bar" role="img" aria-label="${a} ${pct(wifi / total)}, ${b} ${pct(other / total)}">
      <span style="width:${(wifi / total) * 100}%;background:var(--accent)"></span>
      <span style="width:${(other / total) * 100}%;background:var(--up);animation-delay:150ms"></span></div>
    <div class="halves">
      <div><div class="half-label"><i style="background:var(--accent)"></i>${a}</div>
        <div class="half-value accent-text">${fmt(wifi)}</div><div class="half-sub">${pct(wifi / total)} of all traffic</div></div>
      <div><div class="half-label"><i style="background:var(--up)"></i>${b}</div>
        <div class="half-value">${fmt(other)}</div><div class="half-sub">${pct(other / total)} of all traffic</div></div>
    </div>
    <div class="netlist"><div class="netlist-head"><b>${device === 'android' ? 'Wi-Fi networks' : 'Networks'}</b><span>${device === 'android' ? 'collected over USB' : `${nets.length} networks`}</span></div>${rows}</div>${note}`;
}

let tableSort = { key: 'total', asc: false };
function drawTable(d) {
  const cols = [['name', 'App', false], ['tx', 'Sent', true], ['rx', 'Received', true], ['total', 'Total', true], ['rows', 'Records', true]];
  const apps = d.apps.slice(0, 8).slice().sort((a, b) => {
    const r = tableSort.key === 'name' ? a.name.localeCompare(b.name) : a[tableSort.key] - b[tableSort.key];
    return tableSort.asc ? r : -r;
  });
  const maxShare = d.apps[0].total / d.attributed;
  const head = cols.map(([k, label, num]) => {
    const sorted = tableSort.key === k;
    return `<th class="${num ? 'num' : ''}" aria-sort="${sorted ? (tableSort.asc ? 'ascending' : 'descending') : 'none'}"><button type="button" data-sort="${k}">${label}${sorted ? (tableSort.asc ? ' ↑' : ' ↓') : ''}</button></th>`;
  }).join('') + '<th><button type="button" tabindex="-1" style="cursor:default">Share</button></th>';
  const body = apps.map((a) => {
    const share = a.total / d.attributed;
    return `<tr><td><span class="app-cell"><i style="background:${ink(a.color)}"></i>${esc(a.name)}${a.kind ? ` <span class="badge">${a.kind}</span>` : ''}</span></td>
      <td class="num">${fmt(a.tx)}</td><td class="num">${fmt(a.rx)}</td><td class="num total">${fmt(a.total)}</td><td class="num" style="color:var(--text-dim)">${a.rows.toLocaleString('en-US')}</td>
      <td><span class="share"><span class="bar-track"><span class="bar-fill" style="display:block;width:${(share / maxShare) * 100}%;background:${ink(a.color)}"></span></span><span>${pct(share)}</span></span></td></tr>`;
  }).join('');
  const el = document.getElementById('v-table');
  el.innerHTML = `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  el.querySelectorAll('[data-sort]').forEach((btn) => btn.addEventListener('click', () => {
    const k = btn.dataset.sort;
    tableSort = tableSort.key === k ? { key: k, asc: !tableSort.asc } : { key: k, asc: k === 'name' };
    drawTable(d);
    el.querySelector(`[data-sort="${k}"]`).focus();
  }));
}

let device = 'windows';
function drawAll() {
  const d = DATA[device];
  drawStats(d); drawTrend(d); drawHeat(d, false); drawStack(d); drawHour(d);
  drawTop(d); drawAppDay(d); drawSplit(); drawWhere(d, device); drawTable(d);
}

/* ------------------------------------------------------------------ wiring */

function wireTooltip() {
  const tip = document.getElementById('tip');
  const hide = () => { tip.hidden = true; };
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) return hide();
    tip.innerHTML = t.getAttribute('data-tip');
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let left = e.clientX + 14, top = e.clientY + 14;
    if (left + r.width > window.innerWidth - 8) left = e.clientX - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = e.clientY - r.height - 14;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
  });
  document.addEventListener('scroll', hide, { passive: true });
}

function selectShot(btn) {
  document.querySelectorAll('.tabs [role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
  const img = document.getElementById('shot-img');
  img.src = `screenshots/${btn.dataset.shot}.webp`;
  img.alt = btn.dataset.cap;
  document.querySelector('.shot-scroll').scrollTop = 0;
  // The phone capture is in the phone's accent; the tabs follow it.
  document.getElementById('tour').dataset.device = btn.dataset.shot.startsWith('android') ? 'android' : 'windows';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('theme-btn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private window: still switches */ }
    drawAll(); // the heat-map ramp is per theme
  });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (!storedTheme()) { applyTheme(systemTheme()); drawAll(); }
  });

  const tabs = document.querySelectorAll('.tabs [role="tab"]');
  tabs.forEach((b) => b.addEventListener('click', () => selectShot(b)));
  selectShot(tabs[0]);

  const pickDevice = (b) => {
    device = b.dataset.device;
    document.querySelectorAll('.seg [role="radio"]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    document.getElementById('gallery').dataset.device = device;
  };
  document.querySelectorAll('.seg [role="radio"]').forEach((b) => b.addEventListener('click', () => { pickDevice(b); drawAll(); }));
  // ?device=android opens the gallery on the phone, so either view can be linked.
  const asked = new URLSearchParams(location.search).get('device');
  if (asked === 'android') pickDevice(document.querySelector('.seg [data-device="android"]'));

  document.getElementById('gallery').addEventListener('click', (e) => {
    if (!e.target.closest('[data-open="detail"]')) return;
    selectShot(document.querySelector(`[data-shot="${device === 'android' ? 'android-overview' : 'windows-app-detail'}"]`));
    document.getElementById('tour').scrollIntoView();
  });

  wireTooltip();
  drawAll();
});
