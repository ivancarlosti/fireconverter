// Legacy service-worker cleanup.
//
// FireConverter does not use a service worker. Older deployments installed one,
// and browsers keep that worker alive even after the script disappears from the
// server. The SPA fallback used to answer /sw.js with index.html, so the
// browser's update check could never install a replacement. This worker is
// fetched by those old registrations: it drops every cache, takes control of
// open tabs and unregisters itself. It never reloads a tab, so an in-flight
// conversion is not interrupted.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim().catch(() => {});
      const keys = await caches.keys();
      await Promise.allSettled(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      console.info('[FireConverter] legacy service worker removed');
    })(),
  );
});
