'use client';

/**
 * useBarcodeScanner Hook
 * Manages the html5-qrcode scanner lifecycle with React state
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { log } from '@/lib/logger';
import type {
  ScannerState,
  ScanResult,
  ScannerConfig,
  UseBarcodeScanner,
  BarcodeFormat,
} from '../types/scanner';
import { DEFAULT_SCANNER_CONFIG } from '../types/scanner';

// Minimal interface for html5-qrcode scanner instance (dynamic import, avoids SSR issues)
interface Html5QrcodeInstance {
  start: (
    constraints: { facingMode: string } | MediaTrackConstraints,
    config: {
      fps: number;
      qrbox:
        | number
        | { width: number; height: number }
        | ((viewfinderWidth: number, viewfinderHeight: number) => { width: number; height: number });
      aspectRatio: number;
      videoConstraints?: MediaTrackConstraints;
    },
    onSuccess: (decodedText: string, decodedResult: { result: { format?: { formatName?: string } } }) => void,
    onError: (errorMessage: string) => void
  ) => Promise<void>;
  stop: () => Promise<void>;
  isScanning: boolean;
  getRunningTrackCameraCapabilities: () => {
    torchFeature: () => {
      isSupported: () => boolean;
      apply: (state: boolean) => Promise<void>;
    };
  };
}

// Minimal interface for html5-qrcode supported formats enum
interface Html5QrcodeSupportedFormatsEnum {
  QR_CODE: number;
  CODE_128: number;
  CODE_39: number;
  EAN_13: number;
  EAN_8: number;
  UPC_A: number;
  UPC_E: number;
  DATA_MATRIX: number;
  PDF_417: number;
  [key: string]: number;
}

interface Html5QrcodeModule {
  Html5Qrcode: new (elementId: string, config: { verbose?: boolean; formatsToSupport?: number[]; useBarCodeDetectorIfSupported?: boolean }) => Html5QrcodeInstance;
  Html5QrcodeSupportedFormats: Html5QrcodeSupportedFormatsEnum;
}

interface UseBarcodesScannerOptions {
  /** Element ID where the scanner will be rendered */
  elementId: string;
  /** Scanner configuration */
  config?: Partial<ScannerConfig>;
  /** Callback when a barcode is successfully scanned */
  onScan?: (result: ScanResult) => void;
  /** Callback when an error occurs */
  onError?: (error: string) => void;
}

/**
 * React hook for managing barcode scanner
 */
export function useBarcodeScanner({
  elementId,
  config: userConfig,
  onScan,
  onError,
}: UseBarcodesScannerOptions): UseBarcodeScanner {
  const [state, setState] = useState<ScannerState>('idle');
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTorchOn, setIsTorchOn] = useState(false);

  const scannerRef = useRef<Html5QrcodeInstance | null>(null);
  const html5QrcodeRef = useRef<Html5QrcodeModule | null>(null);
  const config = { ...DEFAULT_SCANNER_CONFIG, ...userConfig };

  /**
   * Get the supported formats for html5-qrcode
   */
  const getSupportedFormats = useCallback((formats: Html5QrcodeModule): number[] => {
    const { Html5QrcodeSupportedFormats } = formats;
    const formatMap: Record<BarcodeFormat, number> = {
      QR_CODE: Html5QrcodeSupportedFormats.QR_CODE,
      CODE_128: Html5QrcodeSupportedFormats.CODE_128,
      CODE_39: Html5QrcodeSupportedFormats.CODE_39,
      EAN_13: Html5QrcodeSupportedFormats.EAN_13,
      EAN_8: Html5QrcodeSupportedFormats.EAN_8,
      UPC_A: Html5QrcodeSupportedFormats.UPC_A,
      UPC_E: Html5QrcodeSupportedFormats.UPC_E,
      DATA_MATRIX: Html5QrcodeSupportedFormats.DATA_MATRIX,
      PDF_417: Html5QrcodeSupportedFormats.PDF_417,
    };

    if (!config.formatsToSupport) {
      return [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.EAN_13,
      ];
    }
    return config.formatsToSupport
      .map((format) => formatMap[format])
      .filter(Boolean);
  }, [config.formatsToSupport]);

  /**
   * Start the scanner
   */
  const start = useCallback(async () => {
    if (state === 'scanning' || state === 'initializing') {
      return;
    }

    try {
      setState('initializing');
      setError(null);

      // Dynamically import html5-qrcode (browser only)
      if (!html5QrcodeRef.current) {
        const html5QrcodeModule = await import('html5-qrcode') as unknown as Html5QrcodeModule;
        html5QrcodeRef.current = {
          Html5Qrcode: html5QrcodeModule.Html5Qrcode,
          Html5QrcodeSupportedFormats: html5QrcodeModule.Html5QrcodeSupportedFormats,
        };
      }

      const { Html5Qrcode, Html5QrcodeSupportedFormats } = html5QrcodeRef.current;

      // Create scanner instance if not exists
      if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode(elementId, {
          verbose: config.verbose,
          formatsToSupport: getSupportedFormats({ Html5Qrcode, Html5QrcodeSupportedFormats }),
          useBarCodeDetectorIfSupported: config.useBarCodeDetectorIfSupported ?? false,
        });
      }

      // html5-qrcode accepts a (width, height) => box function and calls it with
      // the live viewfinder size; pass it through untouched so callers can size
      // the region to the frame rather than guessing a constant.
      const qrboxSize = config.qrboxSize ?? 250;

      await scannerRef.current.start(
        { facingMode: config.facingMode ?? 'environment' },
        {
          fps: config.fps ?? 10,
          qrbox: qrboxSize,
          aspectRatio: config.aspectRatio ?? 1.0,
          ...(config.videoConstraints ? { videoConstraints: config.videoConstraints } : {}),
        },
        (decodedText: string, decodedResult: { result: { format?: { formatName?: string } } }) => {
          // Successfully scanned
          const result: ScanResult = {
            decodedText,
            format: decodedResult.result.format?.formatName ?? 'UNKNOWN',
            timestamp: new Date(),
          };
          setLastScan(result);
          onScan?.(result);
        },
        (errorMessage: string) => {
          // Scan error (usually just "no code found" - ignore these)
          if (config.verbose) {
            log.debug('Scan attempt', { message: errorMessage }, 'BarcodeScanner');
          }
        }
      );

      setState('scanning');
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to start scanner';
      setError(errorMessage);
      setState('error');
      onError?.(errorMessage);
    }
  }, [state, elementId, config, getSupportedFormats, onScan, onError]);

  /**
   * Stop the scanner
   */
  const stop = useCallback(async () => {
    if (!scannerRef.current) {
      return;
    }

    try {
      const isScanning = scannerRef.current.isScanning;
      if (isScanning) {
        await scannerRef.current.stop();
      }
      setState('idle');
      setIsTorchOn(false);
    } catch (err) {
      // Ignore stop errors - just log for debugging
      log.debug('Scanner stop error (ignored)', { error: err }, 'BarcodeScanner');
      setState('idle');
    }
  }, []);

  /**
   * Toggle the torch/flashlight
   */
  const toggleTorch = useCallback(async () => {
    if (!scannerRef.current || state !== 'scanning') {
      return;
    }

    try {
      const capabilities = scannerRef.current.getRunningTrackCameraCapabilities();
      if (capabilities.torchFeature().isSupported()) {
        const newState = !isTorchOn;
        await capabilities.torchFeature().apply(newState);
        setIsTorchOn(newState);
      }
    } catch (err) {
      log.debug('Torch not supported or error', { error: err }, 'BarcodeScanner');
    }
  }, [state, isTorchOn]);

  /**
   * Clear the error state
   */
  const clearError = useCallback(() => {
    setError(null);
    if (state === 'error') {
      setState('idle');
    }
  }, [state]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {
          // Ignore cleanup errors
        });
        scannerRef.current = null;
      }
    };
  }, []);

  return {
    state,
    start,
    stop,
    toggleTorch,
    isTorchOn,
    lastScan,
    error,
    clearError,
  };
}

