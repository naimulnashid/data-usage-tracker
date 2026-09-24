import type { MetadataRoute } from 'next';

/**
 * The web app manifest, served at `/manifest.webmanifest`, which is what makes
 * the dashboard installable as its own window.
 *
 * **It is fetched without the session cookie**, so the middleware lets it
 * through. That is why it is static and names no device: device labels and
 * slugs come from the database, and anything read here would be readable by
 * anyone who can reach the port. Per-device shortcuts would have needed exactly
 * that, so there are none.
 *
 * `start_url` is `/`, which forwards to the laptop's page (or to `/login`), so
 * the installed app opens where a bookmark of the bare address would.
 *
 * Installing needs a SECURE CONTEXT -- HTTPS, or `localhost` / `127.0.0.1`.
 * The phones reach this over plain HTTP on the LAN, where a browser offers at
 * most a home-screen shortcut that opens in a tab. See README, "Install as an
 * app".
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Data Usage',
    short_name: 'Data Usage',
    description: 'Local dashboard over per-app network usage history.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // True black, like the page: the splash screen and the title bar then
    // match the first frame instead of flashing a default white.
    background_color: '#000000',
    theme_color: '#000000',
    icons: [
      { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
