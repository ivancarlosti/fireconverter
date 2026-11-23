#!/usr/bin/env node
/**
 * sync-ffmpeg-core.mjs — copies the pinned ffmpeg.wasm core into `public/`.
 *
 * The core is ~31 MiB and is deliberately not committed. `predev` and
 * `prebuild` run this script, so a fresh clone only needs `npm ci`. The Go
 * binary embeds `web/dist`, which is why the copy has to happen before Vite
 * builds.
 */
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(webDir, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const targetDir = join(webDir, 'public', 'ffmpeg');
const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

async function main() {
  await mkdir(targetDir, { recursive: true });
  for (const name of files) {
    const source = join(sourceDir, name);
    const target = join(targetDir, name);
    try {
      const [from, to] = await Promise.all([stat(source), stat(target).catch(() => null)]);
      if (to && to.mtimeMs >= from.mtimeMs && to.size === from.size) {
        continue;
      }
      await copyFile(source, target);
      const written = await stat(target);
      console.log(
        `ffmpeg core: ${name} (${(written.size / 1024 / 1024).toFixed(1)} MiB) -> public/ffmpeg`,
      );
    } catch (error) {
      console.error(`ffmpeg core: cannot copy ${name} from ${source}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

await main();
