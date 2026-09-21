import { iconOf, type AppIconMap } from '@/lib/app-icons';

/**
 * An app's logo, falling back to its colour swatch.
 *
 * The fallback is not a placeholder to be replaced later -- 400+ apps appear in
 * this data and most are background services nobody has a logo for. The swatch
 * is what ties a row to its band in the stacked chart, so it must stay the
 * default rather than leaving a hole.
 *
 * Both variants occupy the same box, so a table of mixed rows keeps its names
 * on one vertical line.
 *
 * `icons` is passed in rather than read here, because this renders inside
 * client components too and the map is built from the filesystem.
 */
export function AppIcon({
  name, color, icons, size = 18,
}: {
  name: string;
  /** The app's chart colour, used for the swatch fallback. */
  color: string;
  icons: AppIconMap;
  /**
   * Any CSS length. Headings pass `em` so the logo scales with the type and
   * stays inside the 1.2 line box -- a fixed pixel size would make the heading
   * taller at small viewports and put the loading skeleton out by a few pixels.
   */
  size?: number | string;
}) {
  const icon = iconOf(icons, name);

  if (!icon) {
    return (
      <span
        className="app-icon app-icon--swatch"
        style={{ width: size, height: size, background: color }}
        aria-hidden
      />
    );
  }

  return (
    <span
      className={`app-icon${icon.plate ? ' app-icon--plate' : ''}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={icon.src} alt="" loading="lazy" decoding="async" />
    </span>
  );
}
