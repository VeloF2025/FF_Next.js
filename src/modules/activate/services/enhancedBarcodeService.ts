/**
 * Enhanced Barcode Extraction Service
 *
 * Server-side barcode scanning with 2D support using:
 * - zxing-wasm for QR codes, Data Matrix, and all 1D formats
 * - Quagga2 as fallback for 1D barcodes
 * - Sharp for image preprocessing (contrast, rotation, etc.)
 *
 * Features:
 * - Multi-format support: QR, Data Matrix, Code 128, Code 39, EAN
 * - Image preprocessing for better detection
 * - Multi-pass scanning with rotation
 * - Confidence scoring
 *
 * @module activate/services/enhancedBarcodeService
 */

import { log } from '@/lib/logger';
import sharp from 'sharp';

// ============================================================================
// TYPES
// ============================================================================

export type BarcodeFormat =
  | 'QR_CODE'
  | 'DATA_MATRIX'
  | 'CODE_128'
  | 'CODE_39'
  | 'EAN_13'
  | 'EAN_8'
  | 'UPC_A'
  | 'UPC_E'
  | 'PDF_417'
  | 'AZTEC'
  | 'UNKNOWN';

export interface EnhancedBarcodeResult {
  success: boolean;
  value: string | null;
  format: BarcodeFormat | null;
  confidence: number;
  method: 'zxing' | 'quagga' | 'preprocessed';
  attempts: number;
  processingTimeMs: number;
  error?: string;
}

export interface MultiBarcodeResult {
  barcodes: Array<{
    value: string;
    format: BarcodeFormat;
    confidence: number;
  }>;
  primarySerial: string | null;
  success: boolean;
  processingTimeMs: number;
}

interface ScanStrategy {
  name: string;
  preprocess: 'none' | 'contrast' | 'sharpen' | 'binarize' | 'invert';
  rotation: 0 | 90 | 180 | 270;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

// ONT serial pattern: ALCL or ALCB followed by alphanumeric
const ONT_SERIAL_PATTERN = /^ALC[LB][A-Z0-9]{7,9}$/i;

// UPS serial pattern: GU18W followed by alphanumeric
const UPS_SERIAL_PATTERN = /^GU18W[A-Z0-9]{8,11}$/i;

// Multi-pass scanning strategies (ordered by likelihood of success)
const SCAN_STRATEGIES: ScanStrategy[] = [
  { name: 'original', preprocess: 'none', rotation: 0 },
  { name: 'contrast', preprocess: 'contrast', rotation: 0 },
  { name: 'sharpen', preprocess: 'sharpen', rotation: 0 },
  { name: 'rotate90', preprocess: 'none', rotation: 90 },
  { name: 'rotate180', preprocess: 'none', rotation: 180 },
  { name: 'rotate270', preprocess: 'none', rotation: 270 },
  { name: 'binarize', preprocess: 'binarize', rotation: 0 },
  { name: 'invert', preprocess: 'invert', rotation: 0 },
];

// Maximum image dimension for processing (larger images are resized)
const MAX_IMAGE_DIMENSION = 1920;

// ============================================================================
// IMAGE PREPROCESSING
// ============================================================================

/**
 * Get sharp instance
 */
function getSharp(imageBuffer: Buffer): sharp.Sharp {
  return sharp(imageBuffer);
}

/**
 * Preprocess image for better barcode detection
 */
async function preprocessImage(
  imageBuffer: Buffer,
  strategy: ScanStrategy
): Promise<Buffer> {
  let pipeline = getSharp(imageBuffer);

  // Apply rotation if needed
  if (strategy.rotation !== 0) {
    pipeline = pipeline.rotate(strategy.rotation);
  }

  // Apply preprocessing based on strategy
  switch (strategy.preprocess) {
    case 'contrast':
      // Increase contrast for better barcode visibility
      pipeline = pipeline.normalise().modulate({ brightness: 1.1, saturation: 0 });
      break;

    case 'sharpen':
      // Sharpen for blurry images
      pipeline = pipeline.sharpen({ sigma: 2, m1: 1.5, m2: 0.7 });
      break;

    case 'binarize':
      // Convert to black and white with threshold
      pipeline = pipeline.greyscale().threshold(128);
      break;

    case 'invert':
      // Invert colors (for negative barcodes)
      pipeline = pipeline.negate();
      break;

    case 'none':
    default:
      // No preprocessing
      break;
  }

  // Ensure reasonable size for processing
  const metadata = await getSharp(imageBuffer).metadata();
  if (metadata.width && metadata.height) {
    const maxDim = Math.max(metadata.width, metadata.height);
    if (maxDim > MAX_IMAGE_DIMENSION) {
      pipeline = pipeline.resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }
  }

  // Convert to PNG for consistent format
  return pipeline.png().toBuffer();
}

/**
 * Get image data for zxing-wasm
 * Returns an object compatible with ImageData interface
 */
async function getImageData(
  imageBuffer: Buffer
): Promise<ImageData> {
  const { data, info } = await getSharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Create ImageData-compatible object
  return {
    data: new Uint8ClampedArray(data),
    width: info.width,
    height: info.height,
    colorSpace: 'srgb',
  } as ImageData;
}

// ============================================================================
// ZXING-WASM SCANNING
// ============================================================================

/**
 * Scan for barcodes using zxing-wasm
 * Supports both 1D and 2D barcodes including QR and Data Matrix
 */
async function scanWithZxing(
  imageBuffer: Buffer
): Promise<{ value: string; format: BarcodeFormat } | null> {
  try {
    // Dynamic import of zxing-wasm reader
    const { readBarcodesFromImageData } = await import('zxing-wasm/reader');

    const imageData = await getImageData(imageBuffer);

    const results = await readBarcodesFromImageData(imageData, {
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
      tryDownscale: true,
      maxNumberOfSymbols: 5,
      formats: [
        'QRCode',
        'DataMatrix',
        'Code128',
        'Code39',
        'EAN-13',
        'EAN-8',
        'UPC-A',
        'UPC-E',
        'PDF417',
        'Aztec',
      ],
    });

    if (results && results.length > 0) {
      // Find the best result (prefer ONT/UPS serials if found)
      for (const result of results) {
        const value = result.text;
        if (value && (ONT_SERIAL_PATTERN.test(value) || UPS_SERIAL_PATTERN.test(value))) {
          return {
            value,
            format: mapZxingFormat(result.format),
          };
        }
      }

      // Return first valid result if no serial pattern matched
      const firstResult = results[0];
      if (firstResult && firstResult.text) {
        return {
          value: firstResult.text,
          format: mapZxingFormat(firstResult.format),
        };
      }
    }

    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.debug('EnhancedBarcode', `zxing scan error: ${message}`);
    return null;
  }
}

/**
 * Map zxing-wasm format to our format type
 */
function mapZxingFormat(format: string): BarcodeFormat {
  const formatMap: Record<string, BarcodeFormat> = {
    QRCode: 'QR_CODE',
    DataMatrix: 'DATA_MATRIX',
    Code128: 'CODE_128',
    Code39: 'CODE_39',
    'EAN-13': 'EAN_13',
    'EAN-8': 'EAN_8',
    'UPC-A': 'UPC_A',
    'UPC-E': 'UPC_E',
    PDF417: 'PDF_417',
    Aztec: 'AZTEC',
  };
  return formatMap[format] || 'UNKNOWN';
}

// ============================================================================
// QUAGGA2 FALLBACK (1D ONLY)
// ============================================================================

/**
 * Scan for 1D barcodes using Quagga2 as fallback
 */
async function scanWithQuagga(
  imageBuffer: Buffer
): Promise<{ value: string; format: BarcodeFormat } | null> {
  try {
    const Quagga = await import('@ericblade/quagga2');

    // Convert buffer to data URL
    const base64 = imageBuffer.toString('base64');
    const dataUrl = `data:image/png;base64,${base64}`;

    return new Promise((resolve) => {
      Quagga.default.decodeSingle(
        {
          src: dataUrl,
          numOfWorkers: 0,
          locate: true,
          decoder: {
            readers: ['code_128_reader', 'code_39_reader', 'ean_reader', 'ean_8_reader'],
          },
        },
        (result) => {
          if (result && result.codeResult && result.codeResult.code) {
            resolve({
              value: result.codeResult.code,
              format: mapQuaggaFormat(result.codeResult.format),
            });
          } else {
            resolve(null);
          }
        }
      );
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.debug('EnhancedBarcode', `Quagga scan error: ${message}`);
    return null;
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
    ean_8: 'EAN_8',
  };
  return formatMap[format] || 'UNKNOWN';
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Scan image for barcodes with multi-pass strategy
 * Tries multiple preprocessing techniques and rotations for best results
 *
 * @param base64Image - Base64 encoded image data
 * @param options - Scan options
 * @returns Enhanced barcode scan result
 */
export async function scanBarcodeEnhanced(
  base64Image: string,
  options?: {
    /** Maximum number of strategies to try (default: all) */
    maxAttempts?: number;
    /** Minimum confidence to accept (default: 0.7) */
    minConfidence?: number;
    /** Skip multi-pass and only try original (faster) */
    quickScan?: boolean;
  }
): Promise<EnhancedBarcodeResult> {
  const startTime = Date.now();
  const { maxAttempts = SCAN_STRATEGIES.length, minConfidence = 0.7, quickScan = false } = options || {};

  try {
    const imageBuffer = Buffer.from(base64Image, 'base64');
    const strategies = quickScan ? [SCAN_STRATEGIES[0]] : SCAN_STRATEGIES.slice(0, maxAttempts);

    log.debug('EnhancedBarcode', `Starting scan with ${strategies.length} strategies`);

    let bestResult: { value: string; format: BarcodeFormat; method: 'zxing' | 'quagga'; strategy: string } | null = null;
    let attempts = 0;

    for (const strategy of strategies) {
      attempts++;

      try {
        // Preprocess image
        const processedBuffer = await preprocessImage(imageBuffer, strategy);

        // Try zxing-wasm first (supports 2D)
        const zxingResult = await scanWithZxing(processedBuffer);
        if (zxingResult && zxingResult.value) {
          log.info('EnhancedBarcode', `zxing found: ${zxingResult.value} (${zxingResult.format}) using ${strategy.name}`);

          // Check if it's a high-value result (ONT/UPS serial)
          const isSerial = ONT_SERIAL_PATTERN.test(zxingResult.value) || UPS_SERIAL_PATTERN.test(zxingResult.value);

          if (isSerial) {
            // Found a serial - return immediately
            return {
              success: true,
              value: zxingResult.value.toUpperCase(),
              format: zxingResult.format,
              confidence: 0.95,
              method: 'zxing',
              attempts,
              processingTimeMs: Date.now() - startTime,
            };
          }

          // Keep as best result but continue looking for serials
          if (!bestResult) {
            bestResult = { ...zxingResult, method: 'zxing', strategy: strategy.name };
          }
        }

        // Try Quagga2 as fallback for 1D barcodes
        if (!zxingResult && strategy.preprocess !== 'invert') {
          const quaggaResult = await scanWithQuagga(processedBuffer);
          if (quaggaResult && quaggaResult.value) {
            log.info('EnhancedBarcode', `Quagga found: ${quaggaResult.value} (${quaggaResult.format}) using ${strategy.name}`);

            const isSerial = ONT_SERIAL_PATTERN.test(quaggaResult.value) || UPS_SERIAL_PATTERN.test(quaggaResult.value);

            if (isSerial) {
              return {
                success: true,
                value: quaggaResult.value.toUpperCase(),
                format: quaggaResult.format,
                confidence: 0.92,
                method: 'quagga',
                attempts,
                processingTimeMs: Date.now() - startTime,
              };
            }

            if (!bestResult) {
              bestResult = { ...quaggaResult, method: 'quagga', strategy: strategy.name };
            }
          }
        }
      } catch (strategyError) {
        log.debug('EnhancedBarcode', `Strategy ${strategy.name} failed: ${strategyError}`);
      }
    }

    // Return best result if found
    if (bestResult) {
      return {
        success: true,
        value: bestResult.value.toUpperCase(),
        format: bestResult.format,
        confidence: 0.85,
        method: bestResult.method,
        attempts,
        processingTimeMs: Date.now() - startTime,
      };
    }

    // No barcode found
    return {
      success: false,
      value: null,
      format: null,
      confidence: 0,
      method: 'zxing',
      attempts,
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('EnhancedBarcode', `Scan failed: ${message}`);

    return {
      success: false,
      value: null,
      format: null,
      confidence: 0,
      method: 'zxing',
      attempts: 0,
      processingTimeMs: Date.now() - startTime,
      error: message,
    };
  }
}

/**
 * Quick scan - tries only original image without preprocessing
 * Use when speed is more important than accuracy
 */
export async function scanBarcodeQuick(base64Image: string): Promise<EnhancedBarcodeResult> {
  return scanBarcodeEnhanced(base64Image, { quickScan: true });
}

/**
 * Extract ONT serial from barcode in image
 * Optimized for Nokia ONT labels with Code 128 or Data Matrix barcodes
 *
 * @param base64Image - Base64 encoded image
 * @returns ONT serial extraction result
 */
export async function extractOntSerialEnhanced(base64Image: string): Promise<{
  success: boolean;
  serial: string | null;
  format: BarcodeFormat | null;
  confidence: number;
  method: string;
  processingTimeMs: number;
}> {
  const result = await scanBarcodeEnhanced(base64Image);

  if (result.success && result.value) {
    const cleanValue = result.value.trim().toUpperCase();

    // Check for exact ONT serial match
    if (ONT_SERIAL_PATTERN.test(cleanValue)) {
      return {
        success: true,
        serial: cleanValue,
        format: result.format,
        confidence: result.confidence,
        method: `barcode-${result.method}`,
        processingTimeMs: result.processingTimeMs,
      };
    }

    // Check if value contains ONT serial as substring
    const match = cleanValue.match(/ALC[LB][A-Z0-9]{7,9}/i);
    if (match) {
      return {
        success: true,
        serial: match[0].toUpperCase(),
        format: result.format,
        confidence: result.confidence * 0.9,
        method: `barcode-${result.method}-substring`,
        processingTimeMs: result.processingTimeMs,
      };
    }

    log.debug('EnhancedBarcode', `Barcode value "${result.value}" is not an ONT serial`);
  }

  return {
    success: false,
    serial: null,
    format: null,
    confidence: 0,
    method: 'barcode-none',
    processingTimeMs: result.processingTimeMs,
  };
}

/**
 * Extract UPS serial from barcode in image
 * Optimized for Gizzu UPS labels
 */
export async function extractUpsSerialEnhanced(base64Image: string): Promise<{
  success: boolean;
  serial: string | null;
  format: BarcodeFormat | null;
  confidence: number;
  processingTimeMs: number;
}> {
  const result = await scanBarcodeEnhanced(base64Image);

  if (result.success && result.value) {
    const cleanValue = result.value.trim().toUpperCase();

    if (UPS_SERIAL_PATTERN.test(cleanValue)) {
      return {
        success: true,
        serial: cleanValue,
        format: result.format,
        confidence: result.confidence,
        processingTimeMs: result.processingTimeMs,
      };
    }

    // Check for substring match
    const match = cleanValue.match(/GU18W[A-Z0-9]{8,11}/i);
    if (match) {
      return {
        success: true,
        serial: match[0].toUpperCase(),
        format: result.format,
        confidence: result.confidence * 0.9,
        processingTimeMs: result.processingTimeMs,
      };
    }
  }

  return {
    success: false,
    serial: null,
    format: null,
    confidence: 0,
    processingTimeMs: result.processingTimeMs,
  };
}

/**
 * Scan for all barcodes in an image
 * Returns all detected barcodes with their values and formats
 */
export async function scanAllBarcodes(base64Image: string): Promise<MultiBarcodeResult> {
  const startTime = Date.now();

  try {
    const imageBuffer = Buffer.from(base64Image, 'base64');
    const { readBarcodesFromImageData } = await import('zxing-wasm/reader');
    const imageData = await getImageData(imageBuffer);

    const results = await readBarcodesFromImageData(imageData, {
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
      maxNumberOfSymbols: 10,
      formats: [
        'QRCode',
        'DataMatrix',
        'Code128',
        'Code39',
        'EAN-13',
        'EAN-8',
        'UPC-A',
        'UPC-E',
      ],
    });

    const barcodes: Array<{ value: string; format: BarcodeFormat; confidence: number }> = [];
    let primarySerial: string | null = null;

    if (results && results.length > 0) {
      for (const result of results) {
        if (result.text) {
          const value = result.text.toUpperCase();
          const format = mapZxingFormat(result.format);

          barcodes.push({
            value,
            format,
            confidence: 0.9,
          });

          // Check for ONT serial
          if (!primarySerial && ONT_SERIAL_PATTERN.test(value)) {
            primarySerial = value;
          }
        }
      }
    }

    return {
      barcodes,
      primarySerial,
      success: barcodes.length > 0,
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('EnhancedBarcode', `Multi-scan failed: ${message}`);

    return {
      barcodes: [],
      primarySerial: null,
      success: false,
      processingTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Check if enhanced barcode service is available
 * Tests that zxing-wasm can be loaded
 */
export async function checkEnhancedBarcodeHealth(): Promise<{
  available: boolean;
  zxingAvailable: boolean;
  quaggaAvailable: boolean;
}> {
  let zxingAvailable = false;
  let quaggaAvailable = false;

  try {
    await import('zxing-wasm/reader');
    zxingAvailable = true;
  } catch {
    log.warn('EnhancedBarcode', 'zxing-wasm not available');
  }

  try {
    await import('@ericblade/quagga2');
    quaggaAvailable = true;
  } catch {
    log.warn('EnhancedBarcode', 'Quagga2 not available');
  }

  return {
    available: zxingAvailable || quaggaAvailable,
    zxingAvailable,
    quaggaAvailable,
  };
}
