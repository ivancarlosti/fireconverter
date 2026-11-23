// Locale-aware formatting helpers. Every size, duration and percentage the SPA
// renders goes through this module.

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** formatBytes renders a decimal size (1 MB = 1,000,000 bytes). */
export function formatBytes(bytes: number, locale = 'en-US'): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = value < 10 && unit > 0 ? 1 : 0;
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(value)} ${BYTE_UNITS[unit]}`;
}

/** formatDuration renders seconds as `m:ss` or `h:mm:ss`. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** formatNumber renders a count with the active locale grouping. */
export function formatNumber(value: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale).format(Number.isFinite(value) ? value : 0);
}

/** formatPercent renders a 0..1 ratio. */
export function formatPercent(ratio: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(ratio) ? ratio : 0);
}

/** clamp keeps a number inside a range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** parsePositive reads a positive number, returning null for empty/invalid. */
export function parsePositive(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
