<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: barcode-scanner
<!-- Camera-based barcode/QR scanning for asset lookup -->

## Purpose
Full-screen camera scanner modal that scans barcodes/QR codes and resolves them to assets via API.

## Key Files
| File | Purpose |
|------|---------|
| `components/BarcodeScannerModal.tsx` | Modal UI: camera feed, viewfinder overlay, result panel |
| `hooks/useBarcodeScanner.ts` | Scanner lifecycle (html5-qrcode, dynamically imported to avoid SSR) |
| `types/scanner.ts` | `BarcodeFormat`, `ScannerState`, `ScanResult`, `AssetLookupResult`, `ScannerConfig` |
| `index.ts` | Exports `BarcodeScannerModal`, `useBarcodeScanner`, `lookupAssetByCode` |

## API Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/assets/search?barcode=<code>` | Primary lookup by barcode field |
| GET | `/api/assets/search?assetNumber=<code>` | Fallback lookup by asset number |

## Critical Rules
- `html5-qrcode` is **dynamically imported** — never import at top level (breaks SSR)
- Scanner DOM element (`id="barcode-scanner-reader"`) must exist before `start()` — use 100ms delay after modal open
- `stop()` must be called on modal close; cleanup on unmount via `useEffect` return
- `lookupAssetByCode` tries barcode first, then assetNumber — `matchedBy` indicates which matched
- `filterByStatus` prop rejects found assets not in the allowed status list with a clear error message
- Torch toggle uses `getRunningTrackCameraCapabilities()` — silently no-ops if device doesn't support it
- States: `idle` → `initializing` → `scanning` | `error`; lookup states: `idle` → `loading` → `found` | `not-found`

## Common Issues
| Problem | Fix |
|---------|-----|
| Camera access denied | `scannerState === 'error'` shown; user clicks "Try Again" which calls `clearError()` |
| Multiple scan triggers | Guard: `if (lookupState === 'loading') return` in `handleScan` |
| Scanner not stopping | Always call `stop()` in modal `onClose` AND in `useEffect` cleanup |

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
