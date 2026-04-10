/**
 * Image Processing Service
 * PRD-033: OCR-First Document Upload Flow
 *
 * Handles image preparation for the VLM:
 * - PDF to PNG conversion via pdftoppm (poppler-utils)
 * - Orientation detection via VLM
 * - Resize and rotation correction via sharp
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import sharp from 'sharp';
import type formidable from 'formidable';
import { log } from '@/lib/logger';
import { VLM_API_URL, VLM_MODEL } from '@/lib/vlm';

/** Max image dimensions for VLM (keeps the model under its token/image-size limit) */
const MAX_IMAGE_WIDTH = 1280;
const MAX_IMAGE_HEIGHT = 960;

/** VLM endpoint — shared with vlmExtractionService */
const VLLM_ENDPOINT = VLM_API_URL;

/**
 * Detect whether an image needs rotation using the VLM.
 *
 * @returns Rotation angle detected: 0, 90, 180, or 270 degrees.
 *          Returns 0 if detection fails (fail-open to avoid blocking the OCR flow).
 */
export async function detectImageOrientation(imageUrl: string): Promise<number> {
  const orientationPrompt = `Look at this image. Is the text/content rotated or sideways?
Answer with ONLY one of these options:
- "0" if text is upright and readable normally
- "90" if text is rotated 90 degrees clockwise (need to rotate counter-clockwise to read)
- "180" if text is upside down
- "270" if text is rotated 90 degrees counter-clockwise (need to rotate clockwise to read)
Return ONLY the number, nothing else.`;

  try {
    const response = await fetch(`${VLLM_ENDPOINT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VLM_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: orientationPrompt },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        max_tokens: 10,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content || '0';
      log.info('VLM orientation response', { rawContent: content });
      // Extract just the number — VLM may include surrounding text
      const match = content.match(/\b(0|90|180|270)\b/);
      const rotation = match?.[1] !== undefined ? parseInt(match[1], 10) : 0;
      log.info('Detected image orientation', { rotation, rawContent: content.substring(0, 100) });
      return rotation;
    }

    log.warn('Orientation detection request failed', { status: response.status });
  } catch (error) {
    log.warn('Orientation detection failed, assuming upright', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return 0;
}

/**
 * Resize and optionally rotate an image to fit within VLM token limits.
 *
 * @param imagePath   Path to the source image file.
 * @param rotationDegrees  Clockwise rotation already detected in the image (0/90/180/270).
 * @returns Path to the processed image.  May be the same as `imagePath` if no changes were needed.
 */
export async function resizeImageForVlm(
  imagePath: string,
  rotationDegrees: number = 0
): Promise<string> {
  const inputBuffer = fs.readFileSync(imagePath);
  const metadata = await sharp(inputBuffer).metadata();
  const { width = 0, height = 0 } = metadata;

  const needsResize = width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT;
  const needsRotation = rotationDegrees !== 0;

  // Return original if no processing needed
  if (!needsResize && !needsRotation) {
    log.info('Image within limits, no processing needed', { width, height });
    return imagePath;
  }

  log.info('Processing image for VLM OCR', {
    originalWidth: width,
    originalHeight: height,
    targetMax: `${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT}`,
    rotation: rotationDegrees,
  });

  const processedPath = path.join(os.tmpdir(), `processed-${Date.now()}.jpg`);

  // Auto-rotate from EXIF metadata first
  let pipeline = sharp(inputBuffer).rotate();

  if (needsRotation) {
    // Convert detected rotation to correction angle:
    // e.g. image rotated 90° CW → correct by rotating 270° CW (or 90° CCW)
    const correctionAngle = (360 - rotationDegrees) % 360;
    log.info('Applying rotation correction', { detected: rotationDegrees, correction: correctionAngle });
    pipeline = pipeline.rotate(correctionAngle);
  }

  if (needsResize) {
    pipeline = pipeline.resize(MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT, {
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  await pipeline.jpeg({ quality: 90 }).toFile(processedPath);

  const newMetadata = await sharp(fs.readFileSync(processedPath)).metadata();
  log.info('Image processed for OCR', {
    newWidth: newMetadata.width,
    newHeight: newMetadata.height,
    originalSize: inputBuffer.length,
    newSize: fs.statSync(processedPath).size,
    rotationApplied: rotationDegrees,
  });

  return processedPath;
}

/**
 * Convert a PDF's first page to a PNG image using pdftoppm (poppler-utils).
 *
 * Uses adaptive DPI based on file size and document type:
 * - ID documents require ≥150 DPI for accurate 13-digit recognition
 * - Large files (>3 MB) use 100 DPI for speed; small files use 200 DPI
 *
 * @returns Path to the resulting PNG file.
 * @throws If pdftoppm fails or the output file is not found.
 */
export async function convertPdfToImage(pdfPath: string, documentType?: string): Promise<string> {
  const tempDir = os.tmpdir();
  const outputBase = path.join(tempDir, `pdf-convert-${Date.now()}`);

  const fileSizeBytes = fs.statSync(pdfPath).size;
  const fileSizeMB = fileSizeBytes / (1024 * 1024);

  // Document types that require higher DPI for accurate digit/text recognition
  const highPrecisionDocTypes = ['sa_id', 'id_document', 'drivers_license', 'passport'];
  const needsHighPrecision = documentType !== undefined && highPrecisionDocTypes.includes(documentType);

  // Adaptive DPI based on file size
  let dpi: number;
  if (fileSizeMB > 3) {
    dpi = 100; // Fast for large files
  } else if (fileSizeMB > 1) {
    dpi = 150; // Balanced
  } else {
    dpi = 200; // High quality for small files
  }

  // Override: ID documents need minimum 150 DPI for accurate digit recognition
  if (needsHighPrecision && dpi < 150) {
    log.info('Boosting DPI for ID document precision', {
      originalDpi: dpi,
      boostedDpi: 150,
      documentType,
    });
    dpi = 150;
  }

  // Adaptive timeout: base 30 s + 10 s per MB over 2 MB
  const conversionTimeout = Math.max(30000, 30000 + Math.floor((fileSizeMB - 2) * 10000));

  log.info('Converting PDF with adaptive DPI', {
    fileSizeMB: fileSizeMB.toFixed(2),
    dpi,
    documentType,
    needsHighPrecision,
    timeoutMs: conversionTimeout,
  });

  try {
    execSync(`pdftoppm -png -f 1 -l 1 -r ${dpi} "${pdfPath}" "${outputBase}"`, {
      timeout: conversionTimeout,
      stdio: 'pipe',
    });

    // pdftoppm names the output file as outputBase-1.png for the first page
    const outputPath = `${outputBase}-1.png`;
    if (fs.existsSync(outputPath)) {
      log.info('PDF converted to image', { pdfPath, outputPath });
      return outputPath;
    }

    // Some versions pad with a leading zero
    const altPath = `${outputBase}-01.png`;
    if (fs.existsSync(altPath)) {
      return altPath;
    }

    throw new Error('PDF conversion output file not found');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('PDF to image conversion failed', { error: message, pdfPath });
    throw new Error(`Failed to convert PDF to image: ${message}`);
  }
}

/**
 * Determine whether an uploaded file is a PDF by extension or MIME type.
 */
export function isPdfFile(file: formidable.File): boolean {
  const filename = file.originalFilename?.toLowerCase() ?? '';
  const mimetype = file.mimetype?.toLowerCase() ?? '';
  return filename.endsWith('.pdf') || mimetype === 'application/pdf';
}
