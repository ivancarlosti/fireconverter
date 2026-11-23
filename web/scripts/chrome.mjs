// Chrome lifecycle and the low-level DevTools socket for the screenshot tooling.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export function chromeBinary() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    for (const dir of ['/usr/bin/', '/usr/local/bin/', '/opt/google/chrome/']) {
      if (existsSync(dir + name)) return dir + name;
    }
  }
  throw new Error('no Chrome/Chromium found: set CHROME_BIN');
}

async function connect(browserURL) {
  const socket = new WebSocket(browserURL);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('the DevTools socket failed')), {
      once: true,
    });
  });
  const client = { socket, nextId: 1, pending: new Map(), listeners: [] };
  client.send = (method, params = {}, sessionId) => {
    const id = client.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      client.pending.set(id, { resolve, reject });
      socket.send(JSON.stringify(payload));
    });
  };
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && client.pending.has(message.id)) {
      const { resolve, reject } = client.pending.get(message.id);
      client.pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
      else resolve(message.result ?? {});
      return;
    }
    for (const listener of client.listeners) listener(message);
  });
  return client;
}

async function waitForPort(profile, timeoutMs = 20000) {
  const file = join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const [port] = (await readFile(file, 'utf8')).split('\n');
      if (port) return `http://127.0.0.1:${Number(port.trim())}`;
    } catch {
      /* not written yet */
    }
    await sleep(120);
  }
  throw new Error('Chrome did not open its DevTools port');
}

async function browserWebSocket(host, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${host}/json/version`);
      const version = await response.json();
      if (version.webSocketDebuggerUrl) return version.webSocketDebuggerUrl;
    } catch {
      /* endpoint not up */
    }
    await sleep(120);
  }
  throw new Error('the DevTools HTTP endpoint never answered');
}

/** launchBrowser starts headless Chrome and attaches one flat session. */
export async function launchBrowser() {
  const profile = join(process.env.TMPDIR ?? '/tmp', `fireconverter-shots-${process.pid}`);
  await rm(profile, { recursive: true, force: true });
  await mkdir(profile, { recursive: true });
  const chrome = spawn(
    chromeBinary(),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TZ: 'UTC' } },
  );
  chrome.stderr.on('data', () => {});

  const host = await waitForPort(profile);
  const client = await connect(await browserWebSocket(host));
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });

  return {
    client,
    sessionId,
    async close() {
      client.socket.close();
      chrome.kill('SIGTERM');
      await sleep(500);
      await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
    },
  };
}
