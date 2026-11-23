// vue-i18n setup: seven catalogs, one persisted language choice.
//
// The active locale lives in `localStorage['fireconverter.locale']`; otherwise
// the browser languages are matched against the shipped catalogs. Every catalog
// is a translation of en-US, which is also the fallback.
import { createI18n } from 'vue-i18n';

import arSA from './locales/ar-SA.json';
import enUS from './locales/en-US.json';
import esMX from './locales/es-MX.json';
import frFR from './locales/fr-FR.json';
import hCN from './locales/h-CN.json';
import hiIN from './locales/hi-IN.json';
import ptBR from './locales/pt-BR.json';

/** LOCALE_KEY holds the persisted language choice. */
export const LOCALE_KEY = 'fireconverter.locale';

const MESSAGES = {
  'en-US': enUS,
  'pt-BR': ptBR,
  'es-MX': esMX,
  'fr-FR': frFR,
  'h-CN': hCN,
  'hi-IN': hiIN,
  'ar-SA': arSA,
};

/** LocaleCode is the union of the shipped catalog codes. */
export type LocaleCode = keyof typeof MESSAGES;

/** DEFAULT_LOCALE mirrors the fallback catalog. */
export const DEFAULT_LOCALE: LocaleCode = 'en-US';

export interface LocaleDescriptor {
  code: string;
  label: string;
  dir: 'ltr' | 'rtl';
}

export const LOCALES: LocaleDescriptor[] = [
  { code: 'en-US', label: 'English', dir: 'ltr' },
  { code: 'pt-BR', label: 'Português (Brasil)', dir: 'ltr' },
  { code: 'es-MX', label: 'Español (México)', dir: 'ltr' },
  { code: 'fr-FR', label: 'Français', dir: 'ltr' },
  { code: 'h-CN', label: '中文（简体）', dir: 'ltr' },
  { code: 'hi-IN', label: 'हिन्दी', dir: 'ltr' },
  { code: 'ar-SA', label: 'العربية', dir: 'rtl' },
];

const catalog: Record<string, LocaleDescriptor> = Object.fromEntries(
  LOCALES.map((locale) => [locale.code, locale]),
);

const ALIASES: Record<string, string> = {
  en: 'en-US',
  pt: 'pt-BR',
  es: 'es-MX',
  fr: 'fr-FR',
  hi: 'hi-IN',
  ar: 'ar-SA',
  zh: 'h-CN',
  'zh-cn': 'h-CN',
  'zh-hans': 'h-CN',
  'zh-hans-cn': 'h-CN',
  'zh-sg': 'h-CN',
  'zh-tw': 'h-CN',
  'zh-hant': 'h-CN',
};

export function isLocale(value: unknown): value is LocaleCode {
  return typeof value === 'string' && value in catalog;
}

export function isRTL(code: string): boolean {
  return catalog[code]?.dir === 'rtl';
}

export function labelOf(code: string): string {
  return catalog[code]?.label ?? code;
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  flatJson: true,
  messages: MESSAGES,
  missingWarn: true,
  fallbackWarn: false,
});

export function readStoredLocale(): string | null {
  try {
    const stored = window.localStorage.getItem(LOCALE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

function matchBrowser(): string | null {
  if (typeof navigator === 'undefined') return null;
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (isLocale(candidate)) return candidate;
    const tag = candidate.toLowerCase();
    if (ALIASES[tag]) return ALIASES[tag];
    const base = tag.split('-')[0];
    if (ALIASES[base]) return ALIASES[base];
  }
  return null;
}

export function detectLocale(fallback: string = DEFAULT_LOCALE): string {
  const stored = readStoredLocale();
  if (stored) return stored;
  return matchBrowser() ?? (isLocale(fallback) ? fallback : DEFAULT_LOCALE);
}

export function applyDocumentLocale(code: string): void {
  const root = document.documentElement;
  root.setAttribute('lang', code);
  root.setAttribute('dir', isRTL(code) ? 'rtl' : 'ltr');
}

function applyLocale(code: string, persist: boolean): string {
  const next = isLocale(code) ? code : DEFAULT_LOCALE;
  i18n.global.locale.value = next;
  if (persist) {
    try {
      window.localStorage.setItem(LOCALE_KEY, next);
    } catch {
      // Persisting is a nicety.
    }
  }
  applyDocumentLocale(next);
  return next;
}

export function setLocale(code: string): string {
  return applyLocale(code, true);
}

export function initLocale(): string {
  const stored = readStoredLocale();
  if (stored) return applyLocale(stored, false);
  return applyLocale(matchBrowser() ?? DEFAULT_LOCALE, false);
}
