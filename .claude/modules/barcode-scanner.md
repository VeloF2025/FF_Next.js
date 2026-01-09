# Module: barcode-scanner

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Camera-based barcode and QR code scanning for asset lookup and management integration |
| **Status** | Active |
| **Complexity** | Medium |
| **Category** | operations |

## Dependencies

### Internal FF Modules
- `assets` (for asset type definitions and lookup)

### External Packages
- react
- html5-qrcode (barcode/QR decoding)
- framer-motion (modal animations)
- lucide-react (icons)

## Database

### Tables
None - uses assets module

### Key Queries
None - delegates to assets module

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/assets/search?barcode={code}` | Lookup by barcode |
| GET | `/api/assets/search?assetNumber={code}` | Lookup by asset number |

## Services
None

## Components
- `BarcodeScannerModal` - Scanner modal UI

## Hooks
- `useBarcodeScanner(options: UseBarcodesScannerOptions)` - Scanner state management
- `lookupAssetByCode(scannedCode: string)` - Async lookup function

## Patterns
- Dynamic import of html5-qrcode to avoid SSR issues
- State machine for scanner lifecycle (idle, initializing, scanning, error)
- Torch/flashlight support for low-light scanning
- Dual fallback lookup (barcode first, then assetNumber)
- Haptic feedback on successful scan
- Modal animation with Framer Motion

### Supported Formats
- QR_CODE
- CODE_128
- CODE_39
- EAN_13
- EAN_8
- UPC_A
- UPC_E
- DATA_MATRIX
- PDF_417

## Gotchas
- **Dynamic Import**: html5-qrcode imported dynamically - can't reference before module loads
- **DOM Requirement**: Scanner element must exist in DOM before initialization
- **Camera Permissions**: Permission request for camera access happens on start()
- **Torch Support**: Torch support varies by device/browser
- **Silent Logging**: "No code found" errors logged in debug mode but not surfaced
- **Cleanup**: Cleanup on unmount ignores errors (silent fail)
