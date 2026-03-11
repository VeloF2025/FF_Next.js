/**
 * Barcode Extraction Service
 *
 * Server-side barcode scanning from images using:
 * - Enhanced service with zxing-wasm for QR, Data Matrix, and 1D barcodes (primary)
 * - Quagga2 for 1D barcodes as fallback
 *
 * This provides more reliable serial number extraction than VLM OCR.
 *
 * @module activate/services/barcodeExtractionService
 */

import { log } from '@/lib/logger';

// Feature flag to use enhanced barcode service (with zxing-wasm 2D support)
const USE_ENHANCED_BARCODE = process.env.USE_ENHANCED_BARCODE !== 'false'; // Enabled by default

// Types for barcode results
export type BarcodeFormat = 'CODE_128' | 'CODE_39' | 'QR_CODE' | 'DATA_MATRIX' | 'EAN_13' | 'UNKNOWN';

export interface BarcodeResult {
  success: boolean;
  value: string | null;
  format: BarcodeFormat | null;
  confidence: number;
  error?: string;
}

export interface MultiBarcodeResult {
  barcodes: Array<{
    value: string;
    format: BarcodeFormat;
  }>;
  primarySerial: string | null;
  success: boolean;
}

// ONT serial pattern: ALCL or ALCB followed by alphanumeric
const ONT_SERIAL_PATTERN = /^ALC[LB][A-Z0-9]{7,9}$/i;

/**
 * Scan for 1D barcodes using Quagga2
 * Best for Code 128 barcodes on Nokia ONT labels
 */
async function scan1DBarcode(imageBuffer: Buffer): Promise<BarcodeResult> {
  try {
    // Dynamic import to avoid SSR issues
    const Quagga = await import('@ericblade/quagga2');

    return new Promise((resolve) => {
      // Convert buffer to data URL for Quagga
      const base64 = imageBuffer.toString('base64');
      const dataUrl = `data:image/jpeg;base64,${base64}`;

      Quagga.default.decodeSingle(
        {
          src: dataUrl,
          numOfWorkers: 0, // Use main thread in Node.js
          locate: true, // Try to locate barcode in image
          decoder: {
            readers: [
              'code_128_reader',
              'code_39_reader',
              'ean_reader',
              'ean_8_reader',
            ],
          },
        },
        (result) => {
          if (result && result.codeResult && result.codeResult.code) {
            const code = result.codeResult.code;
            const format = mapQuaggaFormat(result.codeResult.format);

            log.debug(`1D barcode found: ${code} (${format})`, undefined, 'BarcodeExtraction');

            resolve({
              success: true,
              value: code,
              format,
              confidence: 0.95,
            });
          } else {
            resolve({
              success: false,
              value: null,
              format: null,
              confidence: 0,
            });
          }
        }
      );
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`1D barcode scan failed: ${message}`, undefined, 'BarcodeExtraction');
    return {
      success: false,
      value: null,
      format: null,
      confidence: 0,
      error: message,
    };
  }
}

/**
 * Map Quagga format to our format type
 */
function mapQuaggaFormat(format: string): BarcodeFormat {
  const formatMap: Record<string, BarcodeFormat> = {
    code_128: 'CODE_128',
    code_39: 'CODE_39',
    ean_13: 'EAN_13',
    ean_8: 'EAN_13',
  };
  return formatMap[format] || 'UNKNOWN';
}

/**
 * Scan image for barcodes - uses Quagga2 for 1D barcodes
 *
 * @param base64Image - Base64 encoded image data
 * @returns Barcode scan result
 */
export async function scanBarcodeFromImage(base64Image: string): Promise<BarcodeResult> {
  try {
    // Convert base64 to buffer
    const imageBuffer = Buffer.from(base64Image, 'base64');

    log.debug(`Scanning image (${Math.round(imageBuffer.length / 1024)}KB)`, undefined, 'BarcodeExtraction');

    // Try 1D barcode (Code 128) - most common for Nokia ONT labels
    const code128Result = await scan1DBarcode(imageBuffer);
    if (code128Result.success && code128Result.value) {
      // Check if it's an ONT serial
      if (ONT_SERIAL_PATTERN.test(code128Result.value)) {
        return code128Result;
      }
      // Return anyway, might be useful
      log.debug(`1D barcode found but not ONT serial: ${code128Result.value}`, undefined, 'BarcodeExtraction');
      return code128Result;
    }

    return {
      success: false,
      value: null,
      format: null,
      confidence: 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Barcode scan failed: ${message}`, undefined, 'BarcodeExtraction');
    return {
      success: false,
      value: null,
      format: null,
      confidence: 0,
      error: message,
    };
  }
}

/**
 * Extract ONT serial from barcode in image
 * Returns null if no valid ONT serial found
 *
 * Uses enhanced barcode service (with 2D support) by default,
 * falls back to Quagga2-only scanning if unavailable.
 */
export async function extractOntSerialFromBarcode(base64Image: string): Promise<{
  success: boolean;
  serial: string | null;
  format: BarcodeFormat | null;
  confidence: number;
}> {
  // Try enhanced barcode service first (supports QR, Data Matrix, 2D)
  if (USE_ENHANCED_BARCODE) {
    try {
      const { extractOntSerialEnhanced } = await import('./enhancedBarcodeService');
      const enhancedResult = await extractOntSerialEnhanced(base64Image);

      if (enhancedResult.success && enhancedResult.serial) {
        log.info(`Enhanced scan found: ${enhancedResult.serial} (${enhancedResult.format}, ${enhancedResult.method})`, undefined, 'BarcodeExtraction');
        return {
          success: true,
          serial: enhancedResult.serial,
          format: enhancedResult.format as BarcodeFormat,
          confidence: enhancedResult.confidence,
        };
      }

      // Enhanced service ran but found nothing - still return (skip fallback)
      log.debug(`Enhanced scan found no ONT serial (${enhancedResult.processingTimeMs}ms)`, undefined, 'BarcodeExtraction');
      return {
        success: false,
        serial: null,
        format: null,
        confidence: 0,
      };
    } catch (enhancedError) {
      log.warn(`Enhanced service error, falling back to Quagga: ${enhancedError}`, undefined, 'BarcodeExtraction');
      // Fall through to legacy Quagga2 scanning
    }
  }

  // Legacy Quagga2 scanning (1D only)
  const result = await scanBarcodeFromImage(base64Image);

  if (result.success && result.value) {
    // Validate ONT serial format
    const cleanValue = result.value.trim().toUpperCase();

    if (ONT_SERIAL_PATTERN.test(cleanValue)) {
      return {
        success: true,
        serial: cleanValue,
        format: result.format,
        confidence: result.confidence,
      };
    }

    // Check if value contains ONT serial as substring
    const match = cleanValue.match(/ALC[LB][A-Z0-9]{7,9}/i);
    if (match) {
      return {
        success: true,
        serial: match[0].toUpperCase(),
        format: result.format,
        confidence: result.confidence * 0.9, // Slightly lower confidence for substring match
      };
    }

    log.debug(`Barcode value "${result.value}" is not an ONT serial`, undefined, 'BarcodeExtraction');
  }

  return {
    success: false,
    serial: null,
    format: null,
    confidence: 0,
  };
}

/**
 * Scan with multiple attempts (original + preprocessed)
 */
export async function scanBarcodeWithPreprocessing(base64Image: string): Promise<BarcodeResult> {
  // Try original image first
  const directResult = await scanBarcodeFromImage(base64Image);
  if (directResult.success) {
    return directResult;
  }

  // For now, just return the direct result
  // Image preprocessing can be added later if needed
  return directResult;
}
