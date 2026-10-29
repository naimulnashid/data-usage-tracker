'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatBytes, formatPercent } from '@/lib/format';
import { GlobeIcon, MobileDataIcon, WifiIcon, WiredIcon } from './Icons';

export type Link = 'wifi' | 'wired' | 'mobile' | 'other';

const LINK_LABEL: Record<Link, string> = {
  wifi: 'Wi-Fi',
  wired: 'Wired',
  mobile: 'Mobile data',
  other: 'Other',
};

/** The kind of link as a mark: what the colour squares used to stand in for. */
export function LinkIcon({ kind, size = 17 }: { kind: Link; size?: number }) {
  if (kind === 'wifi') return <WifiIcon size={size} />;
  if (kind === 'wired') return <WiredIcon size={size} />;
  if (kind === 'mobile') return <MobileDataIcon size={size} />;
  return <GlobeIcon size={size} />;
}

/**
 * The per-kind figures across the card's top: an icon, the label, the bytes
 * and the share, one column each.
 */
export function LinkKinds({ kinds, total }: { kinds: { kind: Link; total: number; label?: string }[]; total: number }) {
  const pct = (b: number) => (total ? (b / total) * 100 : 0);
  return (
    <div className={`grid grid--${Math.min(kinds.length, 4)}`}>
      {kinds.map((k) => (
        <div key={k.kind}>
          <div className={`legend-item net-kind net-kind--${k.kind}`}>
            <LinkIcon kind={k.kind} />
            {k.label ?? LINK_LABEL[k.kind]}
          </div>
          <div className={`stat-value net-value--${k.kind}`}>{formatBytes(k.total)}</div>
          <div className="stat-sub">{formatPercent(pct(k.total))} of all traffic</div>
        </div>
      ))}
    </div>
  );
}

export interface DonutNetwork {
  id: string;
  label: string;
  kind: Link;
  /** False when the label is only the interface type. */
  named: boolean;
  aliases: string[];
  total: number;
}

/*
  Slice colours. Wi-Fi networks are shades of the accent and wired ones of
  the second shade the kind figures use, largest first, so the kind split
  still reads off the ring; unnamed profiles are the faint grey the list
  dims them to. Mixed toward the panel, so every step works on both themes.
*/
const WIFI_STEPS = [100, 74, 56, 42, 32, 24];
const WIRED_STEPS = [100, 70, 48];

function sliceColors(networks: DonutNetwork[]): string[] {
  let wifi = 0;
  let wired = 0;
  return networks.map((n) => {
    if (!n.named && n.id !== '0') return 'var(--text-faint)';
    if (n.kind === 'wifi') {
      const keep = WIFI_STEPS[Math.min(wifi++, WIFI_STEPS.length - 1)];
      return `color-mix(in oklab, var(--accent) ${keep}%, var(--bg-panel))`;
    }
    if (n.kind === 'wired') {
      const keep = WIRED_STEPS[Math.min(wired++, WIRED_STEPS.length - 1)];
      return `color-mix(in oklab, color-mix(in srgb, var(--accent) var(--second-keep), var(--second-mix)) ${keep}%, var(--bg-panel))`;
    }
    return 'var(--text-faint)';
  });
}

/**
 * The networks as a ring, largest first, with the list beside it. Every row
 * carries its kind's icon, so which network was Wi-Fi and which was a cable
 * reads without a key.
 */
export function NetworkDonut({ networks, total }: { networks: DonutNetwork[]; total: number }) {
  const colors = sliceColors(networks);
  const pct = (b: number) => (total ? (b / total) * 100 : 0);
  const nameOf = (n: DonutNetwork) => (n.named || n.id === '0' ? n.label : `${n.label}, unnamed`);
  return (
    <div className="donut-wrap">
      <div
        className="donut"
        role="img"
        aria-label={`Traffic by network: ${networks.slice(0, 4).map((n) => `${nameOf(n)} ${formatPercent(pct(n.total))}`).join(', ')}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={networks} dataKey="total" nameKey="id"
              innerRadius="68%" outerRadius="100%" paddingAngle={networks.length > 1 ? 1.5 : 0}
              startAngle={90} endAngle={-270} stroke="var(--bg-panel)" strokeWidth={2}
              animationDuration={800} animationEasing="ease-out" isAnimationActive
            >
              {networks.map((n, i) => <Cell key={n.id} fill={colors[i]} />)}
            </Pie>
            <Tooltip
              // Above the centre total, which follows the chart in the DOM
              // and so painted over the tooltip's text.
              wrapperStyle={{ zIndex: 3 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const n = payload[0]?.payload as DonutNetwork | undefined;
                if (!n) return null;
                return (
                  <div className="chart-tooltip">
                    <div className="chart-tooltip-head"><LinkIcon kind={n.kind} size={15} />{nameOf(n)}</div>
                    <div className="chart-tooltip-value">{formatBytes(n.total)}</div>
                    <div className="chart-tooltip-dim">{formatPercent(pct(n.total))} of all traffic</div>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-centre" aria-hidden>
          <span className="donut-centre-value">{formatBytes(total)}</span>
          <span className="donut-centre-label">{networks.length} {networks.length === 1 ? 'network' : 'networks'}</span>
        </div>
      </div>
      <table className="ssid-table donut-list">
        <tbody>
          {networks.map((n, i) => (
            <tr key={n.id}>
              <td
                className={`ssid-name${n.named ? '' : ' ssid-name--dim'}`}
                title={n.aliases.length ? `${n.label} - also seen as ${n.aliases.join(', ')}` : nameOf(n)}
              >
                <span className="donut-key" style={{ color: colors[i] }}><LinkIcon kind={n.kind} size={16} /></span>
                {nameOf(n)}
                {n.aliases.length > 0 && <span className="ssid-note"> +{n.aliases.length}</span>}
              </td>
              <td className="num">{formatBytes(n.total)}</td>
              <td className="num donut-pct">{formatPercent(pct(n.total))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
