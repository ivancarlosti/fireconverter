// Local image engine. Images never leave the browser.
//
// Target size is reached by binary-searching the encoder quality and, when even
// the lowest quality is too large, by downscaling. PNG has no quality knob, so a
// PNG target reduces dimensions only.
import {
  clampQuality,
  closeDecoded,
  decodeImage,
  dimensionsOf,
  encodeCanvas,
  renderImage,
  resizedDimensions,
  scaleDimensions,
  type Decoded,
  type ImageResize,
} from '@/engine/canvas';
import { ConversionError } from '@/lib/errors';
import { mimeFor, supportsTarget } from '@/lib/formats';

export interface ImageOptions {
  format: string;
  /** quality is 1..100. */
  quality: number;
  targetBytes?: number;
  resize: ImageResize;
  background: string;
}

export interface ImageOutput {
  blob: Blob;
  width: number;
  height: number;
  quality?: number;
}

const MIN_DIMENSION = 16;
const QUALITY_STEPS = 7;
const MAX_SHRINKS = 5;

/** probeImage returns the oriented dimensions of an image. */
export async function probeImage(file: File): Promise<{ width: number; height: number }> {
  const decoded = await decodeImage(file);
  try {
    return dimensionsOf(decoded);
  } finally {
    closeDecoded(decoded);
  }
}

let avifSupport: Promise<boolean> | null = null;

/** supportsAvif feature-detects Canvas AVIF encoding once. */
export function supportsAvif(): Promise<boolean> {
  avifSupport ??= (async () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/avif', 0.8),
      );
      return blob?.type === 'image/avif';
    } catch {
      return false;
    }
  })();
  return avifSupport;
}

/** convertImage decodes, resizes, encodes and verifies the cap. */
export async function convertImage(
  file: File,
  options: ImageOptions,
  onProgress: (percent: number) => void,
): Promise<ImageOutput> {
  const decoded = await decodeImage(file);
  try {
    const source = dimensionsOf(decoded);
    const type = mimeFor('image', options.format);
    if (options.targetBytes && !supportsTarget('image', options.format)) {
      throw new ConversionError('target_unsupported');
    }

    if (!options.targetBytes) {
      onProgress(10);
      const size = resizedDimensions(source, options.resize);
      const canvas = renderImage(decoded, source, size, options.resize, options.format, options.background);
      onProgress(60);
      const quality = options.format === 'png' ? undefined : clampQuality(options.quality / 100);
      const blob = await encodeCanvas(canvas, type, quality);
      onProgress(100);
      return { blob, width: size.width, height: size.height, quality };
    }

    return options.format === 'png'
      ? await encodePNGUnderTarget(decoded, source, options, type, options.targetBytes, onProgress)
      : await encodeLossyUnderTarget(decoded, source, options, type, options.targetBytes, onProgress);
  } finally {
    closeDecoded(decoded);
  }
}

async function encodeLossyUnderTarget(
  decoded: Decoded,
  source: { width: number; height: number },
  options: ImageOptions,
  type: string,
  target: number,
  onProgress: (percent: number) => void,
): Promise<ImageOutput> {
  let scale = 1;
  for (let shrink = 0; shrink <= MAX_SHRINKS; shrink += 1) {
    const size = scaleDimensions(resizedDimensions(source, options.resize), scale);
    if (size.width < MIN_DIMENSION || size.height < MIN_DIMENSION) break;
    const canvas = renderImage(decoded, source, size, options.resize, options.format, options.background);
    let low = 0.05;
    let high = 0.95;
    let best: { blob: Blob; quality: number } | null = null;
    for (let step = 0; step < QUALITY_STEPS; step += 1) {
      const quality = (low + high) / 2;
      const blob = await encodeCanvas(canvas, type, quality);
      onProgress(Math.min(95, ((shrink * QUALITY_STEPS + step + 1) / (MAX_SHRINKS * QUALITY_STEPS + 1)) * 95));
      if (blob.size <= target) {
        best = { blob, quality };
        low = quality;
      } else {
        high = quality;
      }
    }
    if (best) {
      onProgress(100);
      return {
        blob: best.blob,
        width: size.width,
        height: size.height,
        quality: Math.round(best.quality * 100) / 100,
      };
    }
    scale *= 0.78;
  }
  throw new ConversionError('target_too_small');
}

async function encodePNGUnderTarget(
  decoded: Decoded,
  source: { width: number; height: number },
  options: ImageOptions,
  type: string,
  target: number,
  onProgress: (percent: number) => void,
): Promise<ImageOutput> {
  let scale = 1;
  for (let attempt = 0; attempt < 9; attempt += 1) {
    const size = scaleDimensions(resizedDimensions(source, options.resize), scale);
    if (size.width < MIN_DIMENSION || size.height < MIN_DIMENSION) break;
    const canvas = renderImage(decoded, source, size, options.resize, options.format, options.background);
    const blob = await encodeCanvas(canvas, type, undefined);
    onProgress(Math.min(95, ((attempt + 1) / 9) * 95));
    if (blob.size <= target) {
      onProgress(100);
      return { blob, width: size.width, height: size.height };
    }
    const ratio = Math.sqrt(target / blob.size) * 0.95;
    scale *= Math.min(0.95, Math.max(0.35, ratio));
  }
  throw new ConversionError('target_too_small');
}
