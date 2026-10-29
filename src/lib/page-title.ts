import 'server-only';
import type { Metadata } from 'next';
import { windowsDeviceBySlug } from './queries';
import { deviceBySlug } from './android-queries';

/**
 * Page titles: "<page> · <device>".
 *
 * Every page used to share the one title from the root layout, so tabs,
 * history and bookmarks were indistinguishable, and a screen reader announced
 * the same thing on every navigation (WCAG 2.4.2).
 *
 * There is no "· Data Usage Dashboard" suffix any more. The installed app's
 * window prefixes the title with the app's name itself, so the suffix made it
 * "Data Usage Dashboard - By App · <device> · Data Usage Dashboard"; the
 * favicon names the app in a browser tab.
 *
 * A slug that names no device gets "Not found", matching what the page itself
 * renders for it.
 */
function titled(label: string | undefined, page?: string): Metadata {
  if (!label) return { title: 'Not found' };
  return { title: page ? `${page} · ${label}` : label };
}

export function windowsTitle(slug: string, page?: string): Metadata {
  return titled(windowsDeviceBySlug(slug)?.label, page);
}

export function androidTitle(slug: string, page?: string): Metadata {
  return titled(deviceBySlug(slug)?.label, page);
}
