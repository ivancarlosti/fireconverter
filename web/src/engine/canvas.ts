// Canvas primitives of the local image engine.
import { ConversionError } from '@/lib/errors';
import type { Fit } from '@/lib/types';

export type Decoded = ImageBitmap | HTMLImageElement;

export interface ImageResize {
  width?: number;
  height?: number;
  fit: Fit;
  noUpscale: boolean;
}

const MAX_DIMENSION = 16384;

/** decodeImage uses createImageBitmap (EXIF-aware) with an <img> fallback. */
export async function decodeImage(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // SVG and a few browser combinations are not decodable this way.
    }
  }
  return await loadImage(file);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ConversionError('unsupported', 'the browser cannot decode this image'));
    };
    image.src = url;
  });
}

/** dimensionsOf reads the oriented dimensions of a decoded image. */
export function dimensionsOf(decoded: Decoded): { width: number; height: number } {
  if ('naturalWidth' in decoded) {
    return {
      width: decoded.naturalWidth || decoded.width,
      height: decoded.naturalHeight || decoded.height,
    };
  }
  return { width: decoded.width, height: decoded.height };
}

/** closeDecoded frees an ImageBitmap; an <img> needs no cleanup. */
export function closeDecoded(decoded: Decoded): void {
  if ('close' in decoded) decoded.close();
}

/** resizedDimensions applies the width/height/fit/no-upscale rules. */
export function resizedDimensions(
  source: { width: number; height: number },
  resize: ImageResize,
): { width: number; height: number } {
  const requestedWidth = positiveInt(resize.width);
  const requestedHeight = positiveInt(resize.height);
  const { fit, noUpscale } = resize;

  if (!requestedWidth && !requestedHeight) {
    return source;
  }

  if (requestedWidth && requestedHeight) {
    let width = requestedWidth;
    let height = requestedHeight;
    if (fit === 'contain') {
      const scale = Math.min(requestedWidth / source.width, requestedHeight / source.height);
      width = Math.round(source.width * scale);
      height = Math.round(source.height * scale);
    }
    if (noUpscale && (width > source.width || height > source.height)) {
      const scale = Math.min(source.width / width, source.height / height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    return clampDimensions({ width, height });
  }

  const scale = requestedWidth
    ? requestedWidth / source.width
    : requestedHeight! / source.height;
  const bounded = noUpscale ? Math.min(1, scale) : scale;
  return clampDimensions({
    width: Math.round(source.width * bounded),
    height: Math.round(source.height * bounded),
  });
}

/** scaleDimensions shrinks a computed size by a factor. */
export function scaleDimensions(
  size: { width: number; height: number },
  scale: number,
): { width: number; height: number } {
  return clampDimensions({
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  });
}

function clampDimensions(size: { width: number; height: number }): { width: number; height: number } {
  return {
    width: Math.min(MAX_DIMENSION, Math.max(1, size.width)),
    height: Math.min(MAX_DIMENSION, Math.max(1, size.height)),
  };
}

/** renderImage draws the decoded bitmap into a fresh canvas. */
export function renderImage(
  decoded: Decoded,
  source: { width: number; height: number },
  size: { width: number; height: number },
  resize: ImageResize,
  format: string,
  background: string,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) throw new ConversionError('internal', 'the browser refused a 2D canvas');

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  if (format === 'jpg') {
    context.fillStyle = background || '#ffffff';
    context.fillRect(0, 0, size.width, size.height);
  }

  if (resize.fit === 'cover' && (resize.width || resize.height)) {
    const scale = Math.max(size.width / source.width, size.height / source.height);
    const drawWidth = source.width * scale;
    const drawHeight = source.height * scale;
    context.drawImage(
      decoded,
      (size.width - drawWidth) / 2,
      (size.height - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
  } else {
    context.drawImage(decoded, 0, 0, size.width, size.height);
  }
  return canvas;
}

/** encodeCanvas encodes and verifies that the browser honoured the type. */
export async function encodeCanvas(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, quality),
  );
  if (!blob || blob.type !== type) throw new ConversionError('unsupported');
  return blob;
}

/** clampQuality keeps a Canvas quality inside the useful range. */
export function clampQuality(value: number): number {
  return Math.min(0.98, Math.max(0.05, value));
}

function positiveInt(value: number | undefined): number | undefined {
  return value && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}
