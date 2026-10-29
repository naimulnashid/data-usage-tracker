'use client';

import { useState } from 'react';
import type { AppColorMap } from '@/lib/app-colors';
import type { AppIconMap } from '@/lib/app-icons';
import type { DailyPoint } from '@/lib/days';
import { DEFAULT_CHART_DAYS, lastDays, type ChartRange } from '@/lib/scope';
import { formatBytes, formatDayShort } from '@/lib/format';
import { Card, CardTitle } from './Card';
import { AppDailyChart, StackedTimelineChart } from './Charts';
import { ChartLegend } from './ChartLegend';
import { RangeMenu } from './RangeMenu';

type Stack = { points: Record<string, string | number | null>[]; series: string[] };

/**
 * The overview's Daily by app, with its own range menu. Every range arrives
 * ready-made (each ranks its own top apps), so the menu only picks one.
 */
export function DailyByAppCard({
  ranges, colors, icons, delay,
}: {
  ranges: Record<ChartRange, Stack>;
  colors: AppColorMap;
  icons: AppIconMap;
  delay: number;
}) {
  const [days, setDays] = useState<ChartRange>(DEFAULT_CHART_DAYS);
  const { points, series } = ranges[days];
  return (
    <Card delay={delay} hover={false}>
      <CardTitle
        sub={`Top ${series.filter((s) => s !== 'Other').length} apps stacked; everything else grouped as Other`}
        aside={<RangeMenu value={days} onChange={setDays} label="Daily by app range" />}
      >
        Daily by app
      </CardTitle>
      <StackedTimelineChart data={points} series={series} colors={colors} />
      <ChartLegend series={series} colors={colors} icons={icons} />
    </Card>
  );
}

/**
 * An app's Daily usage, with its own range menu. The series is all history,
 * one entry per day, so a range is its tail; the heaviest day is the range's
 * own and sits in the subtitle, which leaves the head's right slot to the menu.
 */
export function AppDailyCard({ daily, delay }: { daily: DailyPoint[]; delay: number }) {
  const [days, setDays] = useState<ChartRange>(DEFAULT_CHART_DAYS);
  const shown = lastDays(daily, days);
  const peak = shown.reduce<DailyPoint | null>(
    (best, d) => ((d.total ?? 0) > (best?.total ?? 0) ? d : best),
    null,
  );
  return (
    <Card delay={delay} hover={false}>
      <CardTitle
        sub={peak ? `Heaviest day ${formatDayShort(peak.date)} · ${formatBytes(peak.total ?? 0)}` : 'Nothing moved in this range'}
        aside={<RangeMenu value={days} onChange={setDays} label="Daily usage range" />}
      >
        Daily usage
      </CardTitle>
      <AppDailyChart data={shown} />
    </Card>
  );
}
