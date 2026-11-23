#!/usr/bin/env node
/** RTL and mobile layout smoke test. Needs a running instance. */
import { join } from 'node:path';

import { createSession, writePng } from './cdp.mjs';

const BASE_URL = (process.env.SMOKE_BASE_URL ?? 'http://localhost:3003').replace(/\/+$/, '');
const OUT = join(process.cwd(), '..', 'tmp');

async function main() {
  const desktop = await createSession({ viewport: { width: 1440, height: 900 }, dpr: 1 });
  try {
    await desktop.session.navigate(BASE_URL + '/');
    await desktop.session.evaluate('document.querySelectorAll("header button")[1].click()');
    await new Promise((resolve) => setTimeout(resolve, 400));
    await desktop.session.clickText('العربية');
    await new Promise((resolve) => setTimeout(resolve, 600));
    const rtl = await desktop.session.evaluate(`({
      dir: document.documentElement.dir,
      lang: document.documentElement.lang,
      heading: document.querySelector('h1')?.textContent?.trim() ?? ''
    })`);
    console.log('rtl:', JSON.stringify(rtl));
    if (rtl.dir !== 'rtl' || rtl.lang !== 'ar-SA') throw new Error('RTL locale did not apply');
    const shot = await desktop.session.capture({ fullPage: false });
    await writePng(join(OUT, 'rtl.png'), shot.buffer);
  } finally {
    await desktop.close();
  }
  if (desktop.errors.length) throw new Error(`desktop console: ${desktop.errors.join(' | ')}`);

  const mobile = await createSession({ viewport: { width: 390, height: 844 }, dpr: 2 });
  try {
    await mobile.session.navigate(BASE_URL + '/');
    const overflow = await mobile.session.evaluate(
      'document.documentElement.scrollWidth - window.innerWidth',
    );
    console.log('mobile overflow:', overflow);
    if (overflow > 1) throw new Error(`horizontal overflow of ${overflow}px`);
    const shot = await mobile.session.capture({ fullPage: true });
    await writePng(join(OUT, 'mobile.png'), shot.buffer);
  } finally {
    await mobile.close();
  }
  if (mobile.errors.length) throw new Error(`mobile console: ${mobile.errors.join(' | ')}`);
  console.log('ui smoke: ok');
}

main().catch((error) => {
  console.error(`ui smoke failed: ${error.message}`);
  process.exitCode = 1;
});
