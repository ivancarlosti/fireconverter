#!/usr/bin/env node
/** Smoke test for the local image engine in target-size mode. */
import { join } from 'node:path';

import { createSession } from './cdp.mjs';

const BASE_URL = (process.env.SMOKE_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const fixture = join(process.cwd(), 'scripts', 'fixtures', 'demo-photo.png');

const { session, errors, close } = await createSession({ viewport: { width: 1440, height: 900 }, dpr: 1 });
try {
  await session.navigate(BASE_URL + '/');
  await session.injectFiles('[data-testid="file-input"]', [fixture]);
  if (!(await session.waitUntil('document.querySelectorAll("[data-testid=file-card]").length === 1'))) {
    throw new Error('image card did not appear');
  }
  await session.evaluate(`(() => {
    const buttons = document.querySelectorAll('[data-testid="file-card"] [data-testid="mode-control"] button[role="radio"]');
    buttons[1].click();
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await session.fill('[data-testid="file-card"] [data-testid="target-input"]', '0.05');
  await session.click('[data-testid="file-card"] [data-testid="convert-button"]');
  if (!(await session.waitUntil('!!document.querySelector("[data-testid=plan-dialog]")', 15000))) {
    throw new Error('image target review did not open');
  }
  await session.clickText('Start conversion');
  if (!(await session.waitUntil('!!document.querySelector("[data-testid=download-button]")', 60000))) {
    throw new Error('image target conversion did not finish');
  }
  const text = await session.evaluate(
    'document.querySelectorAll("[data-testid=file-card]")[0].innerText',
  );
  const match = text.match(/Result[\s\S]*?([\d.]+) KB/);
  if (!match) throw new Error(`could not read the result size from: ${text}`);
  const resultKB = Number(match[1]);
  console.log(`image target result: ${resultKB} KB (cap 50 KB)`);
  if (resultKB > 51) throw new Error(`image target overshot: ${resultKB} KB`);
} finally {
  await close();
}
if (errors.length) {
  console.error('image smoke: browser console errors:');
  for (const error of errors) console.error('  - ' + error);
  process.exitCode = 1;
} else {
  console.log('image smoke: ok');
}
