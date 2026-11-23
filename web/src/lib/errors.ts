/** ConversionError carries a stable code the UI translates. */
export class ConversionError extends Error {
  readonly code: string;
  readonly detail?: string;
  readonly minTargetBytes?: number;

  constructor(code: string, detail?: string, minTargetBytes?: number) {
    super(detail || code);
    this.name = 'ConversionError';
    this.code = code;
    this.detail = detail;
    this.minTargetBytes = minTargetBytes;
  }
}

/** errorCodeOf maps any thrown value to a stable code. */
export function errorCodeOf(error: unknown): string {
  if (error instanceof ConversionError) return error.code;
  if (error instanceof DOMException && error.name === 'AbortError') return 'canceled';
  return 'internal';
}

/** errorDetailOf returns the technical detail of a thrown value. */
export function errorDetailOf(error: unknown): string {
  if (error instanceof ConversionError) return error.detail ?? '';
  if (error instanceof Error) return error.message;
  return String(error);
}
