#!/usr/bin/env node
/**
 * check-i18n.mjs — keeps the seven catalogs in parity with en-US.
 *
 * It checks that every catalog has exactly the same keys, that no value is
 * empty or still contains TODO/FIXME/XXX, that `{placeholders}` match, and that
 * every literal `t('key')` in src/ resolves.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(webDir, 'src');
const localesDir = join(srcDir, 'i18n', 'locales');
const reference = 'en-US';

function filesUnder(dir, suffixes) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      out.push(...filesUnder(full, suffixes));
    } else if (suffixes.some((suffix) => entry.endsWith(suffix))) {
      out.push(full);
    }
  }
  return out;
}

function flatten(value, prefix = '', out = new Map()) {
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      flatten(entry, path, out);
    } else {
      out.set(path, entry);
    }
  }
  return out;
}

function placeholders(value) {
  return [...new Set([...String(value).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]))].sort();
}

const problems = [];
const catalogs = new Map();
for (const file of readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()) {
  const code = file.replace(/\.json$/, '');
  catalogs.set(code, flatten(JSON.parse(readFileSync(join(localesDir, file), 'utf8'))));
}

const base = catalogs.get(reference);
if (!base) {
  console.error(`check-i18n: ${reference}.json is missing from src/i18n/locales`);
  process.exit(1);
}

for (const [code, catalog] of catalogs) {
  for (const [key, value] of base) {
    if (!catalog.has(key)) {
      problems.push(`${code}: missing key "${key}"`);
      continue;
    }
    const translated = catalog.get(key);
    if (typeof translated !== 'string') {
      problems.push(`${code}: "${key}" must be a string`);
      continue;
    }
    if (translated.trim() === '') problems.push(`${code}: "${key}" is empty`);
    const marker = translated.match(/TODO|FIXME|XXX/);
    if (marker) problems.push(`${code}: "${key}" still holds a ${marker[0]}`);
    if (code === reference) continue;
    const expected = placeholders(value);
    const found = placeholders(translated);
    const lost = expected.filter((name) => !found.includes(name));
    const added = found.filter((name) => !expected.includes(name));
    if (lost.length || added.length) {
      problems.push(
        `${code}: "${key}" placeholders differ (missing ${lost.join(', ') || '—'}; extra ${added.join(', ') || '—'})`,
      );
    }
  }
  for (const key of catalog.keys()) {
    if (!base.has(key)) problems.push(`${code}: unknown key "${key}" (not in ${reference})`);
  }
}

const used = new Map();
for (const file of filesUnder(srcDir, ['.ts', '.vue'])) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\b(?:t|te)\(\s*['"]([a-zA-Z0-9_.]+)['"]/g)) {
    const key = match[1];
    if (!used.has(key)) used.set(key, new Set());
    used.get(key).add(relative(webDir, file));
  }
}
for (const [key, where] of used) {
  if (!base.has(key)) problems.push(`unknown key used in ${[...where].join(', ')}: t('${key}')`);
}

if (problems.length) {
  console.error(`check-i18n: ${problems.length} problem(s)\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
function srcHasPrefix(key) {
  return [...used.keys()].some((candidate) => candidate.startsWith(`${key}.`));
}
const skipped = [...base.keys()].filter((key) => !used.has(key) && !srcHasPrefix(key));
console.log(
  `check-i18n: ok — ${catalogs.size} catalogs × ${base.size} keys, ` +
    `${used.size} keys referenced from src/` +
    (skipped.length
      ? `, ${skipped.length} referenced only dynamically (${skipped.slice(0, 4).join(', ')}${skipped.length > 4 ? ', …' : ''})`
      : ''),
);
