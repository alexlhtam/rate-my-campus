'use client';

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1_800_000;
const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
type AcceptedType = typeof acceptedTypes[number];
type Dimensions = { width: number; height: number };

export function validatePhotoFile(file: { size: number; type: string }): void {
  if (!Number.isFinite(file.size) || file.size <= 0) throw new Error('Choose a photo that is not empty.');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Please choose a photo under 5 MB.');
  if (file.type && !acceptedTypes.includes(file.type as AcceptedType)) throw new Error('Choose a JPEG, PNG or WebP photo.');
}

export function identifyPhotoType(header: Uint8Array): AcceptedType | null {
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'image/jpeg';
  if (header.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte)) return 'image/png';
  if (header.length >= 12 && String.fromCharCode(...header.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...header.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export function fitPhotoDimensions(width: number, height: number, maxEdge = 1600): Dimensions {
  if (![width, height, maxEdge].every(value => Number.isFinite(value) && value > 0)) throw new Error('This photo has invalid dimensions.');
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

type DecodedPhoto = Dimensions & { source: CanvasImageSource; dispose: () => void };

async function decodePhoto(file: File): Promise<DecodedPhoto> {
  if (typeof createImageBitmap === 'function') {
    try {
      // Decode using EXIF orientation before drawing. The new JPEG carries only
      // the oriented pixels; no camera/GPS metadata is copied from the original.
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    } catch { /* Native image decoding is the fallback on older browsers. */ }
  }
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('This photo could not be opened. Try another JPEG, PNG or WebP.'));
      image.src = objectUrl;
    });
    // Modern HTML image decoders apply embedded orientation automatically.
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(objectUrl) };
  } catch (error) { URL.revokeObjectURL(objectUrl); throw error; }
}

function encodeJPEG(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob || blob.type !== 'image/jpeg') reject(new Error('Your browser could not prepare this photo. Try another image.'));
    else resolve(blob);
  }, 'image/jpeg', quality));
}

function previewURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('This photo preview could not be created.'));
    reader.onerror = () => reject(new Error('This photo preview could not be created.'));
    reader.readAsDataURL(blob);
  });
}

/** Prepare every photo locally before preview, AI extraction, upload or saving. */
export async function preparePhoto(file: File): Promise<{ file: File; preview: string }> {
  validatePhotoFile(file);
  const actualType = identifyPhotoType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (!actualType || file.type && file.type !== actualType) throw new Error('This file is not a valid JPEG, PNG or WebP photo.');
  const decoded = await decodePhoto(file);
  const canvas = document.createElement('canvas');
  try {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Your browser could not prepare this photo.');
    const attempts = [
      { maxEdge: 1600, quality: 0.9 }, { maxEdge: 1600, quality: 0.8 },
      { maxEdge: 1600, quality: 0.7 }, { maxEdge: 1280, quality: 0.8 },
      { maxEdge: 1024, quality: 0.75 }, { maxEdge: 800, quality: 0.7 },
    ];
    for (const attempt of attempts) {
      const dimensions = fitPhotoDimensions(decoded.width, decoded.height, attempt.maxEdge);
      canvas.width = dimensions.width; canvas.height = dimensions.height;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
      const encoded = await encodeJPEG(canvas, attempt.quality);
      if (encoded.size > MAX_OUTPUT_BYTES) continue;
      // A fresh generic filename and timestamp avoid retaining camera filenames
      // or original capture dates. Canvas serialization removes source metadata.
      const prepared = new File([encoded], 'campus-photo.jpg', { type: 'image/jpeg', lastModified: Date.now() });
      return { file: prepared, preview: await previewURL(prepared) };
    }
    throw new Error('This photo is still too large after resizing. Try a simpler or cropped image.');
  } finally {
    decoded.dispose();
    canvas.width = 1; canvas.height = 1;
  }
}
