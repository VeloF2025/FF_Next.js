/**
 * Barcode Scanner Module
 *
 * Provides camera-based barcode/QR code scanning for asset management.
 * Supports both QR codes and standard barcodes (Code128, EAN-13, etc.)
 *
 * @module barcode-scanner
 */

// Components
export { BarcodeScannerModal } from './components/BarcodeScannerModal';

// Hooks
export { useBarcodeScanner } from './hooks/useBarcodeScanner';

// Utils
export { lookupAssetByCode } from './utils/assetLookup';

// Types
export type {
  BarcodeFormat,
  ScannerState,
  ScanResult,
  AssetLookupResult,
  ScannerConfig,
  BarcodeScannerModalProps,
  UseBarcodeScanner,
} from './types/scanner';

export { DEFAULT_SCANNER_CONFIG } from './types/scanner';
