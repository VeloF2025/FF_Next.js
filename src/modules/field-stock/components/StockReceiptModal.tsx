'use client';

/**
 * StockReceiptModal Component
 * Batch serial scanning for goods receipt (Stage 1 of Stock Tracking System)
 *
 * Purpose: Warehouse staff receives bulk shipment from FibreTime
 * Features:
 * - Batch serial scanning (50+ serials in sequence)
 * - Real-time validation (duplicate detection)
 * - Visual list of scanned serials with remove capability
 * - Generate GRN (Goods Receipt Note) on submit
 */

import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Camera,
  Package,
  Trash2,
  AlertCircle,
  CheckCircle,
  FileText,
  Plus,
  Keyboard,
} from 'lucide-react';
import { modalVariants, overlayVariants } from '@/lib/animations/modal-variants';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { BarcodeScannerModal } from '@/modules/barcode-scanner/components/BarcodeScannerModal';

// ==================== TYPES ====================

export interface ScannedSerial {
  serialNumber: string;
  scannedAt: Date;
  isValid: boolean;
  errorMessage?: string;
}

export interface StockReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  stockItemId: string;
  stockItemName: string;
  supplierName?: string;
  warehouseLocationId: string;
  onSubmit: (data: StockReceiptSubmitData) => Promise<void>;
}

export interface StockReceiptSubmitData {
  stockItemId: string;
  warehouseLocationId: string;
  supplierName: string;
  serials: string[];
  receivedDate: string;
  receivedReference?: string;
  notes?: string;
}

interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
}

// ==================== VALIDATION ====================

function validateSerialNumber(serial: string): ValidationResult {
  // Trim whitespace
  const trimmed = serial.trim();

  if (!trimmed) {
    return { isValid: false, errorMessage: 'Serial number cannot be empty' };
  }

  if (trimmed.length < 3) {
    return { isValid: false, errorMessage: 'Serial number too short' };
  }

  if (trimmed.length > 100) {
    return { isValid: false, errorMessage: 'Serial number too long' };
  }

  // Check for valid characters (alphanumeric, hyphens, underscores)
  const validPattern = /^[A-Za-z0-9\-_]+$/;
  if (!validPattern.test(trimmed)) {
    return { isValid: false, errorMessage: 'Invalid characters in serial' };
  }

  return { isValid: true };
}

// ==================== COMPONENT ====================

export function StockReceiptModal({
  isOpen,
  onClose,
  stockItemId,
  stockItemName,
  supplierName = 'FibreTime',
  warehouseLocationId,
  onSubmit,
}: StockReceiptModalProps) {
  // State
  const [scannedSerials, setScannedSerials] = useState<ScannedSerial[]>([]);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [manualEntry, setManualEntry] = useState('');
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [receivedReference, setReceivedReference] = useState('');

  // Computed values
  const validSerials = useMemo(
    () => scannedSerials.filter((s) => s.isValid),
    [scannedSerials]
  );

  const invalidSerials = useMemo(
    () => scannedSerials.filter((s) => !s.isValid),
    [scannedSerials]
  );

  const existingSerialSet = useMemo(
    () => new Set(scannedSerials.map((s) => s.serialNumber.toUpperCase())),
    [scannedSerials]
  );

  // Add serial to list
  const addSerial = useCallback(
    (serialNumber: string) => {
      const trimmed = serialNumber.trim().toUpperCase();

      // Check for duplicates
      if (existingSerialSet.has(trimmed)) {
        // Update existing entry with duplicate error
        setScannedSerials((prev) =>
          prev.map((s) =>
            s.serialNumber.toUpperCase() === trimmed
              ? { ...s, isValid: false, errorMessage: 'Duplicate scan' }
              : s
          )
        );
        return;
      }

      // Validate serial number format
      const validation = validateSerialNumber(trimmed);

      const newSerial: ScannedSerial = {
        serialNumber: trimmed,
        scannedAt: new Date(),
        isValid: validation.isValid,
        errorMessage: validation.errorMessage,
      };

      setScannedSerials((prev) => [newSerial, ...prev]);

      // Haptic feedback if supported
      if (navigator.vibrate && validation.isValid) {
        navigator.vibrate(50);
      }
    },
    [existingSerialSet]
  );

  // Handle barcode scan result
  const handleBarcodeScan = useCallback(
    (asset: { serialNumber?: string; assetNumber?: string }) => {
      const serial = asset.serialNumber || asset.assetNumber;
      if (serial) {
        addSerial(serial);
      }
      // Keep scanner open for continuous scanning
    },
    [addSerial]
  );

  // Handle manual entry submit
  const handleManualSubmit = useCallback(() => {
    if (manualEntry.trim()) {
      addSerial(manualEntry);
      setManualEntry('');
    }
  }, [manualEntry, addSerial]);

  // Remove serial from list
  const removeSerial = useCallback((serialNumber: string) => {
    setScannedSerials((prev) =>
      prev.filter((s) => s.serialNumber !== serialNumber)
    );
  }, []);

  // Clear all serials
  const clearAll = useCallback(() => {
    setScannedSerials([]);
    setSubmitError(null);
  }, []);

  // Handle form submit
  const handleSubmit = useCallback(async () => {
    if (validSerials.length === 0) {
      setSubmitError('Please scan at least one valid serial number');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await onSubmit({
        stockItemId,
        warehouseLocationId,
        supplierName,
        serials: validSerials.map((s) => s.serialNumber),
        receivedDate: new Date().toISOString(),
        receivedReference: receivedReference || undefined,
        notes: notes || undefined,
      });

      // Success - close modal
      onClose();
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : 'Failed to submit receipt'
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    validSerials,
    stockItemId,
    warehouseLocationId,
    supplierName,
    receivedReference,
    notes,
    onSubmit,
    onClose,
  ]);

  // Handle close
  const handleClose = useCallback(() => {
    if (!isSubmitting) {
      onClose();
    }
  }, [isSubmitting, onClose]);

  // Reset state when modal opens/closes
  const handleModalClose = useCallback(() => {
    setScannedSerials([]);
    setManualEntry('');
    setShowManualEntry(false);
    setSubmitError(null);
    setNotes('');
    setReceivedReference('');
    handleClose();
  }, [handleClose]);

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
            className="fixed inset-0 z-50 bg-black/60"
            onClick={handleModalClose}
          />

          {/* Modal */}
          <motion.div
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed inset-4 z-50 flex flex-col bg-white dark:bg-slate-900 rounded-2xl overflow-hidden md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[600px] md:max-h-[80vh]"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                  <Package className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Stock Receipt
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {stockItemName} from {supplierName}
                  </p>
                </div>
              </div>
              <button
                onClick={handleModalClose}
                disabled={isSubmitting}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Scan Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => setIsScannerOpen(true)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium"
                >
                  <Camera className="w-5 h-5" />
                  Scan Barcodes
                </button>
                <button
                  onClick={() => setShowManualEntry(!showManualEntry)}
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg transition-colors"
                >
                  <Keyboard className="w-5 h-5" />
                </button>
              </div>

              {/* Manual Entry */}
              <AnimatePresence>
                {showManualEntry && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={manualEntry}
                        onChange={(e) => setManualEntry(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleManualSubmit();
                          }
                        }}
                        placeholder="Enter serial number manually"
                        className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      <button
                        onClick={handleManualSubmit}
                        disabled={!manualEntry.trim()}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded-lg transition-colors"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg text-center">
                  <div className="text-2xl font-bold text-slate-900 dark:text-white">
                    {scannedSerials.length}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Total Scanned
                  </div>
                </div>
                <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-center">
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {validSerials.length}
                  </div>
                  <div className="text-xs text-green-600 dark:text-green-400">
                    Valid
                  </div>
                </div>
                <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-center">
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {invalidSerials.length}
                  </div>
                  <div className="text-xs text-red-600 dark:text-red-400">
                    Invalid
                  </div>
                </div>
              </div>

              {/* Reference & Notes */}
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    GRN Reference (Optional)
                  </label>
                  <input
                    type="text"
                    value={receivedReference}
                    onChange={(e) => setReceivedReference(e.target.value)}
                    placeholder="e.g., GRN-2026-01-001"
                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Notes (Optional)
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add any notes about this shipment..."
                    rows={2}
                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  />
                </div>
              </div>

              {/* Scanned Serials List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Scanned Serials
                  </h3>
                  {scannedSerials.length > 0 && (
                    <button
                      onClick={clearAll}
                      className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    >
                      Clear All
                    </button>
                  )}
                </div>

                <div className="max-h-[200px] overflow-y-auto space-y-1 border border-slate-200 dark:border-slate-700 rounded-lg">
                  {scannedSerials.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                      <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No serials scanned yet</p>
                      <p className="text-xs mt-1">
                        Click &quot;Scan Barcodes&quot; to start
                      </p>
                    </div>
                  ) : (
                    scannedSerials.map((serial, index) => (
                      <div
                        key={`${serial.serialNumber}-${index}`}
                        className={`flex items-center justify-between px-3 py-2 ${
                          serial.isValid
                            ? 'bg-white dark:bg-slate-800'
                            : 'bg-red-50 dark:bg-red-900/20'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {serial.isValid ? (
                            <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                          )}
                          <div className="min-w-0">
                            <span className="text-sm font-mono text-slate-900 dark:text-white truncate block">
                              {serial.serialNumber}
                            </span>
                            {serial.errorMessage && (
                              <span className="text-xs text-red-600 dark:text-red-400">
                                {serial.errorMessage}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => removeSerial(serial.serialNumber)}
                          className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors flex-shrink-0"
                        >
                          <Trash2 className="w-4 h-4 text-slate-400 hover:text-red-500" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Submit Error */}
              {submitError && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-sm">{submitError}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
              <button
                onClick={handleModalClose}
                disabled={isSubmitting}
                className="px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || validSerials.length === 0}
                className="flex items-center gap-2 px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white rounded-lg transition-colors font-medium"
              >
                {isSubmitting ? (
                  <>
                    <InlineSpinner size="sm" />
                    Processing...
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4" />
                    Generate GRN ({validSerials.length})
                  </>
                )}
              </button>
            </div>
          </motion.div>

          {/* Barcode Scanner Modal */}
          <BarcodeScannerModal
            isOpen={isScannerOpen}
            onClose={() => setIsScannerOpen(false)}
            onAssetFound={handleBarcodeScan}
            title={`Scan ${stockItemName} Serials`}
          />
        </>
      )}
    </AnimatePresence>
  );
}

export default StockReceiptModal;
