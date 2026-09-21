import { colorOf, type AppColorMap } from '@/lib/app-colors';
import type { AppIconMap } from '@/lib/app-icons';
import { AppIcon } from './AppIcon';

/**
 * The key for a stacked chart.
 *
 * Each entry carries the app's logo where one exists and its colour swatch
 * where one does not. That redundancy is deliberate: brand colours cluster --
 * Edge, VS Code, Windows Update and qBittorrent are all blues -- so the logo is
 * often what actually tells two adjacent bands apart.
 */
export function ChartLegend({
  series, colors, icons,
}: {
  series: string[];
  colors: AppColorMap;
  icons: AppIconMap;
}) {
  return (
    <div className="legend">
      {series.map((name) => {
        const color = colorOf(colors, name);
        return (
          <span key={name} className="legend-item">
            <AppIcon name={name} color={color} icons={icons} size={15} />
            {name}
          </span>
        );
      })}
    </div>
  );
}
