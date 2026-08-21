/**
 * Barcode Scanner Types
 * Type definitions for the barcode scanning module
 */

import type { Asset } from '@/modules/assets/types/asset';

/**
 * Supported barcode formats
 */
export type BarcodeFormat =
  | 'QR_CODE'
  | 'CODE_128'
  | 'CODE_39'
  | 'EAN_13'
  | 'EAN_8'
  | 'UPC_A'
  | 'UPC_E'
  | 'DATA_MATRIX'
  | 'PDF_417';

/**
 * Scanner state
 */
export type ScannerState = 'idle' | 'initializing' | 'scanning' | 'processing' | 'error';

/**
 * Scan result from the scanner
 */
export interface ScanResult {
  /** The decoded text from the barcode/QR code */
  decodedText: string;
  /** The format of the barcode that was scanned */
  format: BarcodeFormat | string;
  /** Timestamp of the scan */
  timestamp: Date;
}

/**
 * Asset lookup result after scanning
 */
export interface AssetLookupResult {
  /** Whether an asset was found */
  found: boolean;
  /** The asset if found */
  asset?: Asset;
  /** The scanned code that was used for lookup */
  scannedCode: string;
  /** Which field matched (barcode or assetNumber) */
  matchedBy?: 'barcode' | 'assetNumber';
  /** Error message if lookup failed */
  error?: string;
}

/**
 * Scanner configuration options
 */
export interface ScannerConfig {
  /** Preferred camera facing mode */
  facingMode?: 'environment' | 'user';
  /** Frames per second for scanning */
  fps?: number;
  /** Size of the scanning box (qrbox) */
  /**
   * Decode region. html5-qrcode only reads INSIDE this box.
   *
   * A function receives the live viewfinder dimensions and is the right choice
   * for dense 2D symbols, which need a region tall enough not to crop them and
   * larger than the symbol itself — a fixed wide/short box cuts them in half
   * (see field-stock-pwa/lib/scanBox.ts).
   */
  qrboxSize?:
    | number
    | { width: number; height: number }
    | ((viewfinderWidth: number, viewfinderHeight: number) => { width: number; height: number });
  /** Aspect ratio of the video feed */
  aspectRatio?: number;
  /** Whether to show the torch/flashlight button */
  showTorchButton?: boolean;
  /** Supported barcode formats */
  formatsToSupport?: BarcodeFormat[];
  /** Verbose logging for debugging */
  verbose?: boolean;
  /** Delegate to the native BarcodeDetector when the browser has one
   *  (Android Chrome) — much stronger on dense 1D than the JS decoder. */
  useBarCodeDetectorIfSupported?: boolean;
  /** Camera resolution request, e.g. { width: { ideal: 1920 } }. Applied via
   *  the scan config — when set, html5-qrcode resolves the camera from THESE
   *  constraints and ignores the facingMode first-arg, so include facingMode
   *  here too. */
  videoConstraints?: MediaTrackConstraints;
}

/**
 * Props for the BarcodeScannerModal component
 */
export interface BarcodeScannerModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when the modal is closed */
  onClose: () => void;
  /** Callback when an asset is successfully found */
  onAssetFound: (asset: Asset) => void;
  /** Optional title for the modal */
  title?: string;
  /** Scanner configuration overrides */
  config?: Partial<ScannerConfig>;
  /** Filter assets by status (e.g., only show 'available' for checkout) */
  filterByStatus?: Asset['status'][];
}

/**
 * Hook return type for useBarcodeScanner
 */
export interface UseBarcodeScanner {
  /** Current scanner state */
  state: ScannerState;
  /** Start the scanner */
  start: () => Promise<void>;
  /** Stop the scanner */
  stop: () => Promise<void>;
  /** Toggle the torch/flashlight */
  toggleTorch: () => Promise<void>;
  /** Whether the torch is on */
  isTorchOn: boolean;
  /** Last scan result */
  lastScan: ScanResult | null;
  /** Error message if any */
  error: string | null;
  /** Clear the error */
  clearError: () => void;
}

/**
 * Default scanner configuration
 */
export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  facingMode: 'environment',
  fps: 10,
  qrboxSize: 250,
  aspectRatio: 1.0,
  showTorchButton: true,
  formatsToSupport: ['QR_CODE', 'CODE_128', 'CODE_39', 'EAN_13', 'EAN_8'],
  verbose: false,
};
