/**
 * Burns a DR/site identifier + capture timestamp into a captured photo so it
 * cannot be reused for a different job: the watermark is part of the JPEG
 * pixels, not metadata. Runs client-side (canvas) before the photo is sent
 * to validation/upload.
 */

import { log } from '@/lib/logger';
import { readFileAsBase64 } from './fileToBase64';

const MODULE = 'watermarkPhoto';

// Cap the longest edge so the canvas (and the uploaded JPEG) stay small enough
// to process on low-end field phones without OOM/jank. A full-resolution camera
// photo (4000×3000+) would otherwise allocate a ~48 MB RGBA backing store on the
// UI thread. 1600px keeps the watermark legible and is ample for VLM QA.
const MAX_EDGE = 1600;

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

/** Encode a canvas as raw base64 JPEG (no data: prefix), falling back on failure. */
function toRawJpeg(canvas: HTMLCanvasElement, fallback: string): string {
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1] ?? fallback;
}

export interface CapturePhotos {
  /**
   * Downscaled JPEG (raw base64) with NO watermark — for VLM grading, so the
   * banner is never burned into the pixels the model scores for photo quality.
   */
  clean: string;
  /**
   * Downscaled JPEG (raw base64) with the site-id/timestamp banner burned in
   * — the copy that is stored, uploaded and escalated.
   */
  watermarked: string;
}

/**
 * Decode a captured photo ONCE, downscale it to {@link MAX_EDGE}, and return
 * both a clean copy (for the VLM) and a watermarked copy (for storage). Falls
 * back to the unmarked original for both if canvas drawing fails — a missing
 * watermark or resize must never block a technician mid-install.
 */
export async function prepareCapturePhotos(
  file: File,
  siteId: string,
  now: Date = new Date(),
): Promise<CapturePhotos> {
  const rawBase64 = await readFileAsBase64(file);
  try {
    const img = await loadImage(`data:${file.type || 'image/jpeg'};base64,${rawBase64}`);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { clean: rawBase64, watermarked: rawBase64 };

    // Downscale once; capture the clean copy BEFORE the banner is drawn.
    ctx.drawImage(img, 0, 0, width, height);
    const clean = toRawJpeg(canvas, rawBase64);

    // Scale the banner with the photo so it stays readable at any resolution.
    const fontSize = Math.max(18, Math.round(width / 32));
    const padding = Math.round(fontSize * 0.5);
    const bannerHeight = fontSize + padding * 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, height - bannerHeight, width, bannerHeight);

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(
      formatWatermarkLabel(siteId, now),
      padding,
      height - bannerHeight / 2,
      width - padding * 2,
    );

    const watermarked = toRawJpeg(canvas, rawBase64);
    return { clean, watermarked };
  } catch (err) {
    log.warn('Watermark/downscale failed — using original photo', { err: String(err) }, MODULE);
    return { clean: rawBase64, watermarked: rawBase64 };
  }
}

/**
 * Returns the watermarked photo as raw base64 JPEG (no data: prefix). Thin
 * wrapper over {@link prepareCapturePhotos} for callers that only need the
 * stored/uploaded copy.
 */
export async function watermarkPhoto(file: File, siteId: string, now: Date = new Date()): Promise<string> {
  return (await prepareCapturePhotos(file, siteId, now)).watermarked;
}
