import { ConversionError } from '@/lib/errors';

const ESTIMATED_WASM_BYTES = 31 * 1024 * 1024;

/** fetchWithProgress streams a core asset and reports 0..100. */
export async function fetchWithProgress(
  url: string,
  signal: AbortSignal,
  onProgress: (percent: number) => void,
): Promise<Uint8Array> {
  const response = await fetch(url, { signal, cache: 'force-cache' });
  if (!response.ok) {
    throw new ConversionError('engine', `the conversion engine returned ${response.status}`);
  }
  const total = Number(response.headers.get('Content-Length')) || ESTIMATED_WASM_BYTES;
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onProgress(100);
    return new Uint8Array(buffer);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(100, (received / total) * 100));
  }
  const output = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  onProgress(100);
  return output;
}
