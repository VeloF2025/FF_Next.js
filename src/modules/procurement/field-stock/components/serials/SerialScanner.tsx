/**
 * SerialScanner Component
 * Scan or manually enter serial numbers for consumption recording
 */

'use client';

import { useState, useCallback, useId, useEffect } from 'react';
import { ScanLine, Check, X, Loader2, AlertCircle, Camera } from 'lucide-react';
import { useBarcodeScanner } from '@/modules/barcode-scanner/hooks/useBarcodeScanner';
import { useSerials } from '../../hooks';
import type { StockSerial } from '../../types';

interface SerialScannerProps {
  onSerialSelected: (serial: StockSerial) => void;
  locationId?: string;
  allowedStatuses?: string[];
  placeholder?: string;
}

export function SerialScanner({
  onSerialSelected,
  locationId,
  allowedStatuses = ['issued', 'available'],
  placeholder = 'Enter or scan serial number...',
}: SerialScannerProps) {
  const [inputValue, setInputValue] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [foundSerial, setFoundSerial] = useState<StockSerial | null>(null);
  const [showCamera, setShowCamera] = useState(false);

  const { getSerial } = useSerials({ autoFetch: false });

  const handleSearch = useCallback(async (serialNumber: string) => {
    if (!serialNumber.trim()) return;

    setSearching(true);
    setError(null);
    setFoundSerial(null);

    try {
      const serial = await getSerial(serialNumber.trim());

      if (!serial) {
        setError(`Serial number "${serialNumber}" not found in the system`);
        return;
      }

      // Validate status
      if (!allowedStatuses.includes(serial.status)) {
        setError(
          `Serial "${serialNumber}" has status "${serial.status}". Expected: ${allowedStatuses.join(' or ')}`
        );
        return;
      }

      // Validate location if provided
      if (locationId && serial.currentLocationId !== locationId) {
        setError(
          `Serial "${serialNumber}" is not at the expected location. Current location: ${serial.locationName || 'Unknown'}`
        );
        return;
      }

      setFoundSerial(serial);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search for serial');
    } finally {
      setSearching(false);
    }
  }, [getSerial, allowedStatuses, locationId]);

  const scannerId = useId().replace(/:/g, '-') + '-scanner';

  const { start: startScanner, stop: stopScanner, toggleTorch, state: scannerState, isTorchOn } = useBarcodeScanner({
    elementId: scannerId,
    onScan: (result) => {
      handleSearch(result.decodedText);
      stopScanner();
      setShowCamera(false);
    },
  });

  useEffect(() => {
    if (showCamera) {
      const timer = setTimeout(() => { startScanner(); }, 150);
      return () => clearTimeout(timer);
    }
    return () => { stopScanner(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCamera]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch(inputValue);
  };

  const handleConfirm = () => {
    if (foundSerial) {
      onSerialSelected(foundSerial);
      setInputValue('');
      setFoundSerial(null);
    }
  };

  const handleClear = () => {
    setInputValue('');
    setFoundSerial(null);
    setError(null);
  };

  return (
    <div className="space-y-4">
      {/* Input Form */}
      <form onSubmit={handleSubmit} className="relative">
        <div className="relative">
          <ScanLine className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value.toUpperCase())}
            placeholder={placeholder}
            className="w-full rounded-lg border border-border bg-card py-3 pl-11 pr-20 text-lg font-mono text-foreground placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
            autoComplete="off"
            autoFocus
          />
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {inputValue && (
              <button
                type="button"
                onClick={handleClear}
                className="rounded-lg p-2 text-gray-400 hover:bg-secondary hover:text-gray-600 dark:hover:bg-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowCamera(!showCamera)}
              className="rounded-lg p-2 text-gray-400 hover:bg-secondary hover:text-gray-600 dark:hover:bg-gray-600"
              title="Scan with camera"
            >
              <Camera className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Search Button */}
        <button
          type="submit"
          disabled={!inputValue.trim() || searching}
          className="mt-2 w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {searching ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching...
            </span>
          ) : (
            'Search Serial'
          )}
        </button>
      </form>

      {/* Camera Placeholder */}
      {showCamera && (
        <div className="space-y-3">
          <div id={scannerId} className="overflow-hidden rounded-lg" style={{ minHeight: 280 }} />
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={toggleTorch}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground hover:bg-background dark:border-gray-600 dark:bg-gray-700"
            >
              {isTorchOn ? 'Torch Off' : 'Torch On'}
            </button>
            <button
              type="button"
              onClick={() => { stopScanner(); setShowCamera(false); }}
              className="text-sm font-medium text-red-600 hover:text-red-500 dark:text-red-400"
            >
              Close Camera
            </button>
          </div>
          {scannerState === 'error' && (
            <p className="text-sm text-red-500">Camera access failed. Check browser permissions.</p>
          )}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-500" />
          <div>
            <p className="text-sm font-medium text-red-800 dark:text-red-200">Serial Not Valid</p>
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        </div>
      )}

      {/* Found Serial Preview */}
      {foundSerial && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-green-100 p-1 dark:bg-green-900/30">
                <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-green-800 dark:text-green-200">
                  Serial Found
                </p>
                <div className="mt-2 space-y-1 text-sm text-green-700 dark:text-green-300">
                  <p>
                    <span className="font-medium">Serial:</span>{' '}
                    <span className="font-mono">{foundSerial.serialNumber}</span>
                  </p>
                  {foundSerial.itemName && (
                    <p>
                      <span className="font-medium">Item:</span> {foundSerial.itemName}
                    </p>
                  )}
                  {foundSerial.macAddress && (
                    <p>
                      <span className="font-medium">MAC:</span>{' '}
                      <span className="font-mono">{foundSerial.macAddress}</span>
                    </p>
                  )}
                  <p>
                    <span className="font-medium">Status:</span>{' '}
                    <span className="capitalize">{foundSerial.status}</span>
                  </p>
                  {foundSerial.locationName && (
                    <p>
                      <span className="font-medium">Location:</span> {foundSerial.locationName}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mt-4 flex gap-2">
            <button
              onClick={handleConfirm}
              className="flex-1 rounded-lg bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              Use This Serial
            </button>
            <button
              onClick={handleClear}
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
