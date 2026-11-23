#!/usr/bin/env node
/** Smoke test for the local ffmpeg engine (WAV → MP3, quality and target size). */
import { join } from 'node:path';

import { createSession } from './cdp.mjs';

const BASE_URL = (process.env.SMOKE_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const fixture = join(process.cwd(), 'scripts', 'fixtures', 'demo-audio.wav');

function log(message) {
  console.log(`smoke: ${message}`);
}

const { session, errors, close } = await createSession({ viewport: { width: 1440, height: 900 }, dpr: 1 });
try {
  await session.navigate(BASE_URL + '/');
  await session.injectFiles('[data-testid="file-input"]', [fixture]);
  if (!(await session.waitUntil('document.querySelectorAll("[data-testid=file-card]").length === 1'))) {
    throw new Error('audio card did not appear');
  }
  await session.waitUntil('!document.querySelector(".animate-spin")', 10000);
  log('card ready');

  await session.click('[data-testid="file-card"] [data-testid="convert-button"]');
  if (!(await session.waitUntil('!!document.querySelector("[data-testid=download-button]")', 180000))) {
    throw new Error('local audio conversion did not finish');
  }
  const quality = await session.evaluate(
    'document.querySelectorAll("[data-testid=file-card]")[0].innerText',
  );
  log(`quality result: ${quality.replace(/\n/g, ' | ').slice(0, 240)}`);

  await session.clickText('Adjust settings');
  await new Promise((resolve) => setTimeout(resolve, 300));
  await session.evaluate(`(() => {
    const buttons = document.querySelectorAll('[data-testid="file-card"] [data-testid="mode-control"] button[role="radio"]');
    buttons[1].click();
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await session.fill('[data-testid="file-card"] [data-testid="target-input"]', '0.05');
  await session.click('[data-testid="file-card"] [data-testid="convert-button"]');
  if (!(await session.waitUntil('!!document.querySelector("[data-testid=plan-dialog]")', 30000))) {
    throw new Error('target review did not open');
  }
  log('target plan opened');
  await session.clickText('Start conversion');
  if (!(await session.waitUntil('!!document.querySelector("[data-testid=download-button]")', 180000))) {
    throw new Error('target-size conversion did not finish');
  }
  const target = await session.evaluate(
    'document.querySelectorAll("[data-testid=file-card]")[0].innerText',
  );
  log(`target result: ${target.replace(/\n/g, ' | ').slice(0, 240)}`);
} finally {
  await close();
}
if (errors.length) {
  console.error('smoke: browser console errors:');
  for (const error of errors) console.error('  - ' + error);
  process.exitCode = 1;
} else {
  log('ok');
}
