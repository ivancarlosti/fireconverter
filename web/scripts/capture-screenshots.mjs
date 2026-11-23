#!/usr/bin/env node
/**
 * capture-screenshots.mjs — regenerates the images the README shows.
 *
 * It drives the installed Chrome/Chromium over the DevTools Protocol, injects
 * the demo files from scripts/fixtures, walks the real workflow (queue → target
 * review → preferences → finished image) and writes PNGs into docs/screenshots.
 *
 * Usage:
 *   npm run screenshots
 *   SCREENSHOT_BASE_URL=http://localhost:3000 npm run screenshots
 */
import { mkdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createSession, writePng } from './cdp.mjs';

const BASE_URL = (process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const OUT_DIR = resolve(process.env.SCREENSHOT_DIR ?? join(process.cwd(), '..', 'docs', 'screenshots'));
const DPR = Number(process.env.SCREENSHOT_DPR ?? 2);
const MAX_HEIGHT = Number(process.env.SCREENSHOT_MAX_HEIGHT ?? 2800);
const VIEWPORT = { width: 1440, height: 900 };
const FIXTURES = join(process.cwd(), 'scripts', 'fixtures');
const DEMO_FILES = [
  join(FIXTURES, 'demo-photo.png'),
  join(FIXTURES, 'demo-audio.wav'),
  join(FIXTURES, 'demo-video.mp4'),
];

async function existing(paths) {
  const found = [];
  for (const path of paths) {
    try {
      await access(path);
      found.push(path);
    } catch {
      console.warn(`fixture missing, skipping: ${path}`);
    }
  }
  return found;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const files = await existing(DEMO_FILES);
  if (files.length === 0) throw new Error('no demo fixtures found in web/scripts/fixtures');

  const { session, errors, close } = await createSession({ viewport: VIEWPORT, dpr: DPR });
  const written = [];

  async function shot(name, title, { fullPage = true } = {}) {
    const { buffer, height } = await session.capture({ fullPage, maxHeight: MAX_HEIGHT });
    const path = join(OUT_DIR, `${name}.png`);
    await writePng(path, buffer, { quantize: true });
    written.push(buffer.length);
    console.log(
      `  ${name.padEnd(18)} ${title.padEnd(26)} ${String(Math.round(buffer.length / 1024)).padStart(5)} KiB  ` +
        `${VIEWPORT.width}x${height}@${DPR}x`,
    );
  }

  try {
    await session.navigate(BASE_URL + '/');
    await shot('01-home', 'Empty queue');

    await session.injectFiles('[data-testid="file-input"]', files);
    const expected = files.length;
    const ready = await session.waitUntil(
      `document.querySelectorAll('[data-testid="file-card"]').length === ${expected}`,
      15000,
    );
    if (!ready) throw new Error('the file cards never appeared');
    await session.waitUntil("!document.querySelector('.animate-spin')", 15000);
    await new Promise((resolve) => setTimeout(resolve, 700));
    await shot('02-queue', 'Queue with settings');

    const firstCard = `document.querySelectorAll('[data-testid="file-card"]')[0]`;
    const switched = await session.evaluate(`(() => {
      const card = ${firstCard};
      const buttons = card.querySelectorAll('[data-testid="mode-control"] button[role="radio"]');
      if (buttons.length < 2) return 'missing';
      buttons[1].click();
      return 'clicked';
    })()`);
    if (switched !== 'clicked') throw new Error('the target mode button was not found');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await session.fill('[data-testid="file-card"] [data-testid="target-input"]', '0.4');
    await session.click('[data-testid="file-card"] [data-testid="convert-button"]');
    const planOpen = await session.waitUntil('!!document.querySelector("[data-testid=\\"plan-dialog\\"]")', 15000);
    if (!planOpen) throw new Error('the target review dialog never opened');
    await new Promise((resolve) => setTimeout(resolve, 500));
    await shot('03-target-size', 'Target-size review', { fullPage: false });

    await session.pressEscape();
    await session.waitUntil('!document.querySelector("[data-testid=\\"plan-dialog\\"]")', 5000);
    await session.evaluate(`(() => {
      const buttons = document.querySelectorAll('header button');
      if (!buttons.length) return 'missing';
      buttons[0].click();
      return 'clicked';
    })()`);
    const settingsOpen = await session.waitUntil('!!document.querySelector("[data-testid=\\"settings-dialog\\"]")', 5000);
    if (!settingsOpen) throw new Error('the preferences dialog never opened');
    await new Promise((resolve) => setTimeout(resolve, 400));
    await shot('04-preferences', 'Preferences', { fullPage: false });
    await session.pressEscape();
    await new Promise((resolve) => setTimeout(resolve, 400));

    await session.evaluate(`(() => {
      const card = ${firstCard};
      const buttons = card.querySelectorAll('[data-testid="mode-control"] button[role="radio"]');
      if (buttons.length < 1) return 'missing';
      buttons[0].click();
      return 'clicked';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await session.click('[data-testid="file-card"] [data-testid="convert-button"]');
    const done = await session.waitUntil(
      '!!document.querySelector("[data-testid=\\"download-button\\"]")',
      30000,
    );
    if (!done) throw new Error('the image conversion never completed');
    try {
      await session.clickText('Hide settings');
    } catch {
      // The card may already be compact.
    }
    await new Promise((resolve) => setTimeout(resolve, 6500));
    await shot('05-complete', 'Finished conversion');
  } finally {
    await close();
  }

  if (errors.length) {
    console.error(`browser console errors:\n  - ${errors.join('\n  - ')}`);
    process.exitCode = 1;
  }
  const total = written.reduce((sum, size) => sum + size, 0);
  console.log(`wrote ${written.length} screenshots, ${(total / 1024 / 1024).toFixed(2)} MiB in total`);
}

main().catch((error) => {
  console.error(`screenshot capture failed: ${error.message}`);
  process.exitCode = 1;
});
