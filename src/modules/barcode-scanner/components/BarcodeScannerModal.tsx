'use client';

/**
 * BarcodeScannerModal Component
 * Full-screen camera scanner modal for scanning asset barcodes/QR codes
 */

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Camera, CameraOff, Flashlight, FlashlightOff, AlertCircle } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { modalVariants, overlayVariants } from '@/lib/animations/modal-variants';
import { useBarcodeScanner, lookupAssetByCode } from '../hooks/useBarcodeScanner';
import type { BarcodeScannerModalProps, ScanResult, AssetLookupResult } from '../types/scanner';
import type { Asset } from '@/modules/assets/types/asset';
import { log } from '@/lib/logger';
import { Button } from '@/components/ui/button';

const SCANNER_ELEMENT_ID = 'barcode-scanner-reader';

export function BarcodeScannerModal({
  isOpen,
  onClose,
  onAssetFound,
  title = 'Scan Asset Barcode',
  config,
  filterByStatus,
}: BarcodeScannerModalProps) {
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'found' | 'not-found'>('idle');
  const [lookupResult, setLookupResult] = useState<AssetLookupResult | null>(null);
  const [foundAsset, setFoundAsset] = useState<Asset | null>(null);

  const handleScan = useCallback(
    async (result: ScanResult) => {
      // Prevent multiple lookups
      if (lookupState === 'loading') return;

      setLookupState('loading');
      setLookupResult(null);

      const lookup = await lookupAssetByCode(result.decodedText);

      if (lookup.found && lookup.asset) {
        // Check if asset matches status filter
        if (filterByStatus && filterByStatus.length > 0) {
          if (!filterByStatus.includes(lookup.asset.status)) {
            setLookupState('not-found');
            setLookupResult({
              found: false,
              scannedCode: result.decodedText,
              error: `Asset found but status is "${lookup.asset.status}". Expected: ${filterByStatus.join(' or ')}.`,
            });
            return;
          }
        }

        setFoundAsset(lookup.asset);
        setLookupState('found');
        setLookupResult({
          found: true,
          asset: lookup.asset,
          scannedCode: result.decodedText,
          matchedBy: lookup.matchedBy,
        });

        // Haptic feedback if supported
        if (navigator.vibrate) {
          navigator.vibrate(100);
        }
      } else {
        setLookupState('not-found');
        setLookupResult({
          found: false,
          scannedCode: result.decodedText,
          error: lookup.error || 'Asset not found',
        });
      }
    },
    [lookupState, filterByStatus]
  );

  const {
    state: scannerState,
    start,
    stop,
    toggleTorch,
    isTorchOn,
    error: scannerError,
    clearError,
  } = useBarcodeScanner({
    elementId: SCANNER_ELEMENT_ID,
    config,
    onScan: handleScan,
    onError: (error) => {
      log.error('Scanner error', { error }, 'BarcodeScannerModal');
    },
  });

  // Start scanner when modal opens
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure DOM element is rendered
      const timer = setTimeout(() => {
        start();
      }, 100);
      return () => clearTimeout(timer);
    } else {
      stop();
      // Reset state when modal closes
      setLookupState('idle');
      setLookupResult(null);
      setFoundAsset(null);
    }
  }, [isOpen, start, stop]);

  // Handle selecting the found asset
  const handleSelectAsset = useCallback(() => {
    if (foundAsset) {
      onAssetFound(foundAsset);
      onClose();
    }
  }, [foundAsset, onAssetFound, onClose]);

  // Reset and try again
  const handleTryAgain = useCallback(() => {
    setLookupState('idle');
    setLookupResult(null);
    setFoundAsset(null);
    clearError();
  }, [clearError]);

  // Handle close
  const handleClose = useCallback(() => {
    stop();
    onClose();
  }, [stop, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Overlay */}
          <motion.div
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed inset-0 z-50 bg-black/80"
            onClick={handleClose}
          />

          {/* Modal */}
          <motion.div
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed inset-4 z-50 flex flex-col bg-slate-900 rounded-2xl overflow-hidden md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[500px] md:h-[600px]"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <div className="flex items-center gap-2">
                <Camera className="w-5 h-5 text-blue-400" />
                <h2 className="text-lg font-semibold text-white">{title}</h2>
              </div>
              <Button variant="ghost" size="icon" onClick={handleClose}>
                <X className="w-5 h-5 text-slate-400" />
              </Button>
            </div>

            {/* Scanner Area */}
            <div className="flex-1 relative bg-black">
              {/* Scanner container */}
              <div
                id={SCANNER_ELEMENT_ID}
                className="w-full h-full"
                style={{ minHeight: '300px' }}
              />

              {/* Scanner state overlays */}
              {scannerState === 'initializing' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <div className="text-center">
                    <LoadingSpinner size="lg" label="" className="mb-2" />
                    <p className="text-white">Starting camera...</p>
                  </div>
                </div>
              )}

              {scannerState === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                  <div className="text-center px-4">
                    <CameraOff className="w-12 h-12 text-red-400 mx-auto mb-3" />
                    <p className="text-white font-medium mb-2">Camera Access Required</p>
                    <p className="text-slate-400 text-sm mb-4">
                      {scannerError || 'Please allow camera access to scan barcodes'}
                    </p>
                    <Button variant="primary" onClick={handleTryAgain}>
                      Try Again
                    </Button>
                  </div>
                </div>
              )}

              {lookupState === 'loading' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <div className="text-center">
                    <LoadingSpinner size="lg" label="" className="mb-2" />
                    <p className="text-white">Looking up asset...</p>
                  </div>
                </div>
              )}

              {/* Viewfinder overlay */}
              {scannerState === 'scanning' && lookupState === 'idle' && (
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-64 h-64 border-2 border-blue-400 rounded-lg relative">
                      {/* Corner markers */}
                      <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-blue-400 rounded-tl-lg" />
                      <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-blue-400 rounded-tr-lg" />
                      <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-blue-400 rounded-bl-lg" />
                      <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-blue-400 rounded-br-lg" />
                    </div>
                  </div>
                  <p className="absolute bottom-4 left-0 right-0 text-center text-white text-sm">
                    Position barcode within the frame
                  </p>
                </div>
              )}

              {/* Torch button */}
              {scannerState === 'scanning' && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleTorch}
                  className="absolute top-4 right-4"
                >
                  {isTorchOn ? (
                    <FlashlightOff className="w-5 h-5 text-yellow-400" />
                  ) : (
                    <Flashlight className="w-5 h-5 text-slate-300" />
                  )}
                </Button>
              )}
            </div>

            {/* Results Area */}
            <div className="p-4 border-t border-slate-700 min-h-[120px]">
              {lookupState === 'idle' && (
                <p className="text-slate-400 text-center text-sm">
                  Point your camera at a barcode or QR code to scan
                </p>
              )}

              {lookupState === 'found' && foundAsset && (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-green-900/30 border border-green-700 rounded-lg">
                    <div className="flex-1">
                      <p className="text-green-400 font-medium text-sm mb-1">Asset Found!</p>
                      <p className="text-white font-semibold">{foundAsset.name}</p>
                      <p className="text-slate-400 text-sm">
                        {foundAsset.assetNumber} {foundAsset.serialNumber && `• S/N: ${foundAsset.serialNumber}`}
                      </p>
                      <p className="text-slate-400 text-xs mt-1">
                        Status: <span className="capitalize">{foundAsset.status}</span>
                        {lookupResult?.matchedBy && (
                          <span className="text-slate-500"> • Matched by {lookupResult.matchedBy}</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={handleTryAgain} className="flex-1">
                      Scan Another
                    </Button>
                    <Button variant="primary" onClick={handleSelectAsset} className="flex-1">
                      Select Asset
                    </Button>
                  </div>
                </div>
              )}

              {lookupState === 'not-found' && (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-red-900/30 border border-red-700 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-red-400 font-medium text-sm mb-1">Asset Not Found</p>
                      <p className="text-slate-300 text-sm">
                        {lookupResult?.error || 'No matching asset found'}
                      </p>
                      {lookupResult?.scannedCode && (
                        <p className="text-slate-500 text-xs mt-1">
                          Scanned: {lookupResult.scannedCode}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button variant="secondary" onClick={handleTryAgain} className="w-full">
                    Try Again
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default BarcodeScannerModal;
