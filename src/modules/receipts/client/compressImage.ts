/**
 * Client-side image compression for the /my/receipts capture flow.
 *
 * Mirrors the helper used by ConditionPhotoCapture (assets module) but
 * lives here so importing it doesn't pull the assets-component bundle.
 * Keeps image upload sizes small enough that 4G + spotty signal still
 * makes it through to the OCR endpoint.
 */

export interface CompressOptions {
  maxDim?: number;
  quality?: number;
}

export async function compressFileToJpeg(
  file: File,
  { maxDim = 1280, quality = 0.85 }: CompressOptions = {}
): Promise<Blob> {
  const dataUrl = await fileToDataUrl(file);
  return compressDataUrl(dataUrl, maxDim, quality);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Reader returned non-string result'));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function compressDataUrl(dataUrl: string, maxDim: number, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context not available'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Compression failed'))),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => reject(new Error('Failed to load image for compression'));
    img.src = dataUrl;
  });
}
