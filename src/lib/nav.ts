import type { DeviceId } from './accent';

/**
 * What each device is, and what pages it has.
 *
 * Shared by the sidebar (which lists devices) and the top bar (which lists that
 * device's pages), so the two cannot disagree about which routes exist.
 *
 * **Every device is addressed the same way: `/<platform>/<slug>/...`.** The
 * laptop used to be the exception, sitting on bare `/`, `/apps` and `/sync`
 * because there is only ever one Windows machine per install. That saved a path
 * segment and cost more than it saved: the machine you were looking at had no
 * name anywhere in the address bar, a bookmark to "the dashboard" and a
 * bookmark to "the laptop" were the same URL, and every helper that takes a
 * device -- logos, page tabs, detail links -- needed a Windows special case
 * beside the phone path. The old URLs still work; they redirect (see
 * `src/app/page.tsx` and its siblings).
 */

export interface DevicePage {
  href: string;
  label: string;
  /** True for a section root, which needs an exact match to light up. */
  root?: boolean;
  /** Sub-pages of a root that are views of it rather than tabs of their own. */
  within?: string[];
}

/**
 * URL-safe name for a device.
 *
 * Lives here rather than beside either device's queries because both halves
 * derive their slug with it and neither owns it. A phone's comes from the label
 * the phone reports, the laptop's from `deviceLabel` in `config/collector.json`
 * -- Windows has nothing to ask, and a hostname is rarely what a person calls
 * their laptop.
 *
 * Derived from the label rather than from any internal id so the address is
 * readable: `/android/pixel-8`, not
 * `/android/<the random install id>`.
 */
export function deviceSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'device';
}

/** The three pages of one device, rooted at its own URL. */
function pagesUnder(base: string): DevicePage[] {
  return [
    // The expanded heat map is the overview's Activity card at full size.
    { href: base, label: 'Overview', root: true, within: [`${base}/activity`] },
    { href: `${base}/apps`, label: 'By App' },
    { href: `${base}/sync`, label: 'Sync Status' },
  ];
}

/** The Windows page set, rooted at one laptop. */
export function windowsPages(slug: string): DevicePage[] {
  return pagesUnder(`/windows/${slug}`);
}

/** The Android page set, rooted at one phone. */
export function androidPages(slug: string): DevicePage[] {
  return pagesUnder(`/android/${slug}`);
}

/**
 * The tabs for whatever page is currently open.
 *
 * Derives the slug from the path rather than taking it as a prop: the top bar
 * renders inside a client shell that has the pathname anyway, and threading the
 * slug down from a server layout would mean the tabs briefly disagreeing with
 * the URL during a device switch.
 *
 * Both platforms are shaped `/<platform>/<slug>`, so the slug is segment 2 for
 * either of them and there is no Windows special case left here.
 */
export function pagesForPath(device: DeviceId, pathname: string): DevicePage[] {
  const slug = pathname.split('/')[2];
  if (!slug) return [];
  return device === 'android' ? androidPages(slug) : windowsPages(slug);
}
