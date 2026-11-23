#!/usr/bin/env node
/** Smoke test for the legacy service-worker kill switch. */
import { createSession } from './cdp.mjs';

const BASE_URL = (process.env.SMOKE_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

const { session, errors, close } = await createSession({
  viewport: { width: 1280, height: 800 },
  dpr: 1,
});
try {
  await session.navigate(BASE_URL + '/');
  const result = await session.evaluate(`(async () => {
    const marker = 'fireconverter-legacy-sw-test';
    const cache = await caches.open(marker);
    await cache.put('/legacy-worker', new Response('stale'));
    const registration = await navigator.serviceWorker.register('/sw.js');
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const keys = await caches.keys();
      if (!registrations.some((item) => item.scope === registration.scope) && keys.length === 0) {
        return { registrations: 0, caches: keys };
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return {
      registrations: (await navigator.serviceWorker.getRegistrations()).length,
      caches: await caches.keys(),
    };
  })()`);
  if (result.registrations !== 0) {
    throw new Error(`the kill switch left ${result.registrations} registration(s)`);
  }
  if (result.caches.length !== 0) {
    throw new Error(`the kill switch left caches: ${result.caches.join(', ')}`);
  }
  console.log('service worker smoke: legacy worker and caches removed');
} finally {
  await close();
}
if (errors.length) {
  console.error('service worker smoke: browser console errors:');
  for (const error of errors) console.error('  - ' + error);
  process.exitCode = 1;
} else {
  console.log('service worker smoke: ok');
}
