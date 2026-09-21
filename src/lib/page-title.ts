import 'server-only';
import type { Metadata } from 'next';
import { windowsDeviceBySlug } from './queries';
import { deviceBySlug } from './android-queries';

/**
 * Page titles: "<page> · <device> · Data Usage".
 *
 * Every page used to share the one title from the root layout, so tabs,
 * history and bookmarks were indistinguishable, and a screen reader announced
 * the same thing on every navigation (WCAG 2.4.2). The root layout supplies
 * the "· Data Usage" suffix as a template; these supply the rest.
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
