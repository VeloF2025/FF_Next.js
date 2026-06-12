/**
 * Burns a DR/site identifier + capture timestamp into a captured photo so it
 * cannot be reused for a different job: the watermark is part of the JPEG
 * pixels, not metadata. Runs client-side (canvas) before the photo is sent
 * to validation/upload.
 */

import { readFileAsBase64 } from './fileToBase64';

/** "DR1866766 • 2026-06-12 11:41" (or pole id for civils). */
export function formatWatermarkLabel(siteId: string, when: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ` +
    `${pad(when.getHours())}:${pad(when.getMinutes())}`;
  return `${siteId} • ${stamp}`;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode captured photo'));
    img.src = dataUrl;
  });
}

/**
 * Returns the watermarked photo as raw base64 JPEG (no data: prefix).
 * Falls back to the unmarked original if canvas drawing fails — a missing
 * watermark must never block a technician mid-install.
 */
export async function watermarkPhoto(file: File, siteId: string, now: Date = new Date()): Promise<string> {
  const rawBase64 = await readFileAsBase64(file);
  try {
    const img = await loadImage(`data:${file.type || 'image/jpeg'};base64,${rawBase64}`);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return rawBase64;

    ctx.drawImage(img, 0, 0);

    // Scale the banner with the photo so it stays readable at any resolution.
    const fontSize = Math.max(18, Math.round(canvas.width / 32));
    const padding = Math.round(fontSize * 0.5);
    const bannerHeight = fontSize + padding * 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, canvas.height - bannerHeight, canvas.width, bannerHeight);

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(
      formatWatermarkLabel(siteId, now),
      padding,
      canvas.height - bannerHeight / 2,
      canvas.width - padding * 2,
    );

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return dataUrl.split(',')[1] ?? rawBase64;
  } catch {
    return rawBase64;
  }
}
