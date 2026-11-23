// Session helpers: evaluate, navigate, click, file injection and screenshots.
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import { launchBrowser } from './chrome.mjs';

/** createSession launches Chrome and returns a tab helper plus console errors. */
export async function createSession({ viewport = { width: 1440, height: 900 }, dpr = 2 } = {}) {
  const browser = await launchBrowser();
  const send = (method, params = {}) => browser.client.send(method, params, browser.sessionId);
  const errors = [];

  const session = {
    send,
    async evaluate(expression) {
      const answer = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.text ?? 'page exception');
      return answer.result?.value;
    },
    async waitUntil(expression, timeoutMs = 15000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await session.evaluate(expression)) return true;
        await sleep(120);
      }
      return false;
    },
    async navigate(url) {
      await send('Page.navigate', { url });
      await session.waitUntil('document.readyState === "complete"');
      await session.waitUntil(
        `(() => { const app = document.querySelector('#app'); return !!app && app.children.length > 0; })()`,
      );
      await sleep(400);
    },
    async click(selector) {
      const result = await session.evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return 'missing';
        element.click();
        return 'clicked';
      })()`);
      if (result !== 'clicked') throw new Error(`no element for ${selector}`);
    },
    async clickText(text) {
      const result = await session.evaluate(`(() => {
        const wanted = ${JSON.stringify(text)};
        const candidate = [...document.querySelectorAll('button, a, [role="menuitem"]')].find(
          (element) => element.textContent.trim().includes(wanted),
        );
        if (!candidate) return 'missing';
        candidate.click();
        return 'clicked';
      })()`);
      if (result !== 'clicked') throw new Error(`no button containing ${text}`);
    },
    async injectFiles(selector, files) {
      const { root } = await send('DOM.getDocument', { depth: -1, pierce: true });
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
      if (!nodeId) throw new Error(`no file input for ${selector}`);
      await send('DOM.setFileInputFiles', { nodeId, files });
      await session.evaluate(
        `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change', { bubbles: true }))`,
      );
    },
    async fill(selector, value) {
      const result = await session.evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return 'missing';
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(element, ${JSON.stringify(String(value))});
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return 'filled';
      })()`);
      if (result !== 'filled') throw new Error(`no input for ${selector}`);
    },
    async pressEscape() {
      const base = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await sleep(300);
    },
    async capture({ fullPage = true, maxHeight = 2800 } = {}) {
      const metrics = await send('Page.getLayoutMetrics');
      const content = metrics.cssContentSize ?? metrics.contentSize;
      const height = fullPage ? Math.min(Math.ceil(content.height), maxHeight) : viewport.height;
      const shot = await send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: fullPage,
        clip: { x: 0, y: 0, width: viewport.width, height, scale: 1 },
      });
      return { buffer: Buffer.from(shot.data, 'base64'), height };
    },
    errors,
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('DOM.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: dpr,
    mobile: false,
  });
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  });
  browser.client.listeners.push((message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails?.text ?? 'page exception');
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      errors.push(message.params.entry.text);
    }
  });

  return { session, errors, close: browser.close };
}

/** writePng saves a capture, optionally quantizing it through Pillow. */
export async function writePng(path, buffer, { quantize = false } = {}) {
  await writeFile(path, buffer);
  if (!quantize) return;
  await new Promise((resolve) => {
    const child = spawn('python3', [
      '-c',
      "import sys; from PIL import Image; [Image.open(p).convert('RGB').quantize(colors=256, method=Image.MEDIANCUT).save(p, optimize=True) for p in sys.argv[1:]]",
      path,
    ]);
    child.on('exit', resolve);
  });
}
