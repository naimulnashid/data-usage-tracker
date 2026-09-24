/**
 * Service worker for the installed app. It does ONE thing: when a page
 * navigation cannot reach the server, it answers with a static "dashboard
 * unreachable" page instead of the browser's own error screen.
 *
 * **It caches nothing but that page, deliberately.** Everything this dashboard
 * serves is a record of which programs ran on this machine and when, behind a
 * password. A worker that cached pages or API responses would write that record
 * to the browser's disk, where it outlives a sign-out and is readable without
 * the password. Every request other than a navigation is left alone entirely
 * -- no respondWith -- so the network sees exactly what it did before.
 *
 * Served from `public/` at `/sw.js` because a worker's scope cannot be wider
 * than its own directory, and it has to cover `/`. The middleware lets it, and
 * `/pwa/*`, through without a session: the worker script and the offline page
 * are both fetched before any page has had a chance to sign in.
 *
 * Bump CACHE when offline.html changes, or installed apps keep the old copy.
 */
const CACHE = 'offline-v1';
const OFFLINE = '/pwa/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // `reload` so the copy stored comes from the server, not the HTTP cache.
      .then((cache) => cache.add(new Request(OFFLINE, { cache: 'reload' })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    // Navigation preload starts the network request while the worker boots,
    // so passing a navigation through costs nothing measurable.
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  // Next's client-side navigations are RSC fetches, not navigations, and pass
  // straight through. When one fails, Next falls back to a full navigation,
  // which lands here.
  if (event.request.mode !== 'navigate') return;

  event.respondWith((async () => {
    try {
      const preloaded = await event.preloadResponse;
      if (preloaded) return preloaded;
      return await fetch(event.request);
    } catch {
      return (await caches.match(OFFLINE)) ?? Response.error();
    }
  })());
});
