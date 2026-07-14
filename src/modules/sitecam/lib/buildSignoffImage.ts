/**
 * Composite the customer sign-off (printed name + consent + drawn signature)
 * into a single dark-theme image File. The File is fed through the wizard's
 * normal onCapture → watermark → upload pipeline as step 10's photo, so no
 * storage or schema change is needed — it lands in `pwa_photo_urls` like any
 * other step. The DR number + capture time are added by the pipeline's
 * watermark, so they are intentionally NOT drawn here.
 *
 * Canvas-based; browser-only (no SSR / jsdom canvas).
 */

const BG = '#171717'; // neutral-900, matches SignaturePad
const TEXT = '#e5e5e5'; // neutral-200
const MUTED = '#a3a3a3'; // neutral-400
const WIDTH = 640;
const PAD = 24;
const LINE_GAP = 26;
// Leaves room at the bottom so the pipeline's watermark banner never overlaps
// the signature or consent text.
const BOTTOM_RESERVED = 72;

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('signature image failed to load'));
    img.src = dataUrl;
  });
}

export interface SignoffImageInput {
  name: string;
  consentText: string;
  signatureDataUrl: string;
}

/**
 * Build the composite sign-off image. Rejects if the canvas 2D context or the
 * signature image is unavailable — the caller surfaces the failure rather than
 * silently uploading an incomplete artifact.
 */
export async function buildSignoffImage({
  name,
  consentText,
  signatureDataUrl,
}: SignoffImageInput): Promise<File> {
  const sig = await loadImage(signatureDataUrl);
  const contentWidth = WIDTH - PAD * 2;
  // Scale the signature to the content width, preserving aspect ratio.
  const sigWidth = contentWidth;
  const sigHeight = sig.height > 0 ? Math.round((sig.width > 0 ? sig.height / sig.width : 0.33) * sigWidth) : 200;

  // Measure text height with a throwaway context so the canvas is sized to fit.
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('canvas 2D context unavailable');
  measure.font = '15px sans-serif';
  const consentLines = wrapLines(measure, `✓ ${consentText}`, contentWidth);

  let y = PAD;
  const headingH = LINE_GAP;
  const nameH = LINE_GAP;
  const consentH = consentLines.length * 22 + 8;
  const height = y + headingH + nameH + consentH + 12 + sigHeight + BOTTOM_RESERVED;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2D context unavailable');

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.textBaseline = 'top';

  // Heading
  ctx.fillStyle = MUTED;
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText('CUSTOMER SIGN-OFF', PAD, y);
  y += headingH;

  // Printed name
  ctx.fillStyle = TEXT;
  ctx.font = '16px sans-serif';
  ctx.fillText(`Name: ${name.trim()}`, PAD, y);
  y += nameH;

  // Consent statement (wrapped, with a check mark)
  ctx.fillStyle = MUTED;
  ctx.font = '15px sans-serif';
  for (const line of consentLines) {
    ctx.fillText(line, PAD, y);
    y += 22;
  }
  y += 12;

  // Signature
  ctx.drawImage(sig, PAD, y, sigWidth, sigHeight);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92),
  );
  if (!blob) throw new Error('failed to encode sign-off image');
  return new File([blob], 'customer-signoff.jpg', { type: 'image/jpeg' });
}
