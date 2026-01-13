'use client';

/**
 * DailyCheckoutModal Component
 * Issue stock to technicians each morning (Stage 2 of Stock Tracking System)
 *
 * Purpose: Site supervisor issues ONTs/Kiesers to technicians for day's work
 * Features:
 * - Select item type (ONT, Kieser, etc.)
 * - Batch serial scanning (10-30 serials per technician)
 * - Visual list with "Remove" buttons
 * - Digital signature capture
 * - Generate picking slip (ISS-YYYYMM-#####)
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Camera,
  UserCheck,
  Trash2,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  FileText,
  Plus,
  Keyboard,
  PenTool,
  Eraser,
} from 'lucide-react';
import { modalVariants, overlayVariants } from '@/lib/animations/modal-variants';
import { BarcodeScannerModal } from '@/modules/barcode-scanner/components/BarcodeScannerModal';

// ==================== TYPES ====================

export interface CheckoutSerial {
  serialNumber: string;
  scannedAt: Date;
  isValid: boolean;
  errorMessage?: string;
  stockItemId?: string;
  stockItemName?: string;
}

export interface Technician {
  id: string;
  name: string;
  phone?: string;
  contractorId?: string;
  contractorName?: string;
  locationId?: string;
}

export interface StockItemOption {
  id: string;
  name: string;
  itemCode: string;
  category: string;
}

export interface DailyCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  technician: Technician;
  stockItems: StockItemOption[];
  warehouseLocationId: string;
  projectId?: string;
  onSubmit: (data: DailyCheckoutSubmitData) => Promise<void>;
  validateSerial?: (serialNumber: string, stockItemId: string) => Promise<{
    valid: boolean;
    errorMessage?: string;
    serial?: { id: string; stockItemId: string };
  }>;
}

export interface DailyCheckoutSubmitData {
  technicianId: string;
  technicianName: string;
  technicianLocationId?: string;
  contractorId?: string;
  contractorName?: string;
  sourceLocationId: string;
  projectId?: string;
  serials: {
    serialNumber: string;
    stockItemId: string;
  }[];
  signatureData: string;
  notes?: string;
}

// ==================== SIGNATURE CANVAS ====================

interface SignatureCanvasProps {
  onSignatureChange: (dataUrl: string | null) => void;
  width?: number;
  height?: number;
}

function SignatureCanvas({
  onSignatureChange,
  width = 400,
  height = 150,
}: SignatureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set up canvas
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, [width, height]);

  const getCoordinates = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      if ('touches' in e) {
        const touch = e.touches[0];
        return {
          x: (touch.clientX - rect.left) * scaleX,
          y: (touch.clientY - rect.top) * scaleY,
        };
      }

      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    },
    []
  );

  const startDrawing = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      const coords = getCoordinates(e);
      if (!coords) return;

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!ctx) return;

      ctx.beginPath();
      ctx.moveTo(coords.x, coords.y);
      setIsDrawing(true);
    },
    [getCoordinates]
  );

  const draw = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDrawing) return;
      e.preventDefault();

      const coords = getCoordinates(e);
      if (!coords) return;

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!ctx) return;

      ctx.lineTo(coords.x, coords.y);
      ctx.stroke();
      setHasSignature(true);
    },
    [isDrawing, getCoordinates]
  );

  const stopDrawing = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false);
      const canvas = canvasRef.current;
      if (canvas && hasSignature) {
        onSignatureChange(canvas.toDataURL('image/png'));
      }
    }
  }, [isDrawing, hasSignature, onSignatureChange]);

  const clearSignature = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, height);
    setHasSignature(false);
    onSignatureChange(null);
  }, [width, height, onSignatureChange]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Technician Signature
        </label>
        <button
          type="button"
          onClick={clearSignature}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-500 transition-colors"
        >
          <Eraser className="w-3 h-3" />
          Clear
        </button>
      </div>
      <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg overflow-hidden">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="w-full touch-none cursor-crosshair bg-slate-50 dark:bg-slate-800"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>
      {!hasSignature && (
        <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
          <PenTool className="w-3 h-3" />
          Sign above to confirm receipt
        </p>
      )}
    </div>
  );
}

// ==================== COMPONENT ====================

export function DailyCheckoutModal({
  isOpen,
  onClose,
  technician,
  stockItems,
  warehouseLocationId,
  projectId,
  onSubmit,
  validateSerial,
}: DailyCheckoutModalProps) {
  // State
  const [selectedItemId, setSelectedItemId] = useState<string>(
    stockItems[0]?.id || ''
  );
  const [scannedSerials, setScannedSerials] = useState<CheckoutSerial[]>([]);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [manualEntry, setManualEntry] = useState('');
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [signatureData, setSignatureData] = useState<string | null>(null);

  // Computed values
  const selectedItem = useMemo(
    () => stockItems.find((item) => item.id === selectedItemId),
    [stockItems, selectedItemId]
  );

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

  // Group serials by item
  const serialsByItem = useMemo(() => {
    const grouped = new Map<string, CheckoutSerial[]>();
    for (const serial of validSerials) {
      const itemId = serial.stockItemId || 'unknown';
      if (!grouped.has(itemId)) {
        grouped.set(itemId, []);
      }
      grouped.get(itemId)!.push(serial);
    }
    return grouped;
  }, [validSerials]);

  // Add serial to list
  const addSerial = useCallback(
    async (serialNumber: string) => {
      const trimmed = serialNumber.trim().toUpperCase();

      // Check for duplicates
      if (existingSerialSet.has(trimmed)) {
        return;
      }

      // Start with pending state
      const newSerial: CheckoutSerial = {
        serialNumber: trimmed,
        scannedAt: new Date(),
        isValid: false,
        errorMessage: 'Validating...',
        stockItemId: selectedItemId,
        stockItemName: selectedItem?.name,
      };

      setScannedSerials((prev) => [newSerial, ...prev]);

      // Validate serial if validator provided
      if (validateSerial) {
        try {
          const result = await validateSerial(trimmed, selectedItemId);
          setScannedSerials((prev) =>
            prev.map((s) =>
              s.serialNumber === trimmed
                ? {
                    ...s,
                    isValid: result.valid,
                    errorMessage: result.errorMessage,
                    stockItemId: result.serial?.stockItemId || selectedItemId,
                  }
                : s
            )
          );

          // Haptic feedback if supported
          if (navigator.vibrate && result.valid) {
            navigator.vibrate(50);
          }
        } catch {
          setScannedSerials((prev) =>
            prev.map((s) =>
              s.serialNumber === trimmed
                ? {
                    ...s,
                    isValid: false,
                    errorMessage: 'Validation failed',
                  }
                : s
            )
          );
        }
      } else {
        // No validator - assume valid
        setScannedSerials((prev) =>
          prev.map((s) =>
            s.serialNumber === trimmed
              ? {
                  ...s,
                  isValid: true,
                  errorMessage: undefined,
                }
              : s
          )
        );

        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
      }
    },
    [existingSerialSet, selectedItemId, selectedItem, validateSerial]
  );

  // Handle barcode scan result
  const handleBarcodeScan = useCallback(
    (asset: { serialNumber?: string; assetNumber?: string }) => {
      const serial = asset.serialNumber || asset.assetNumber;
      if (serial) {
        addSerial(serial);
      }
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

    if (!signatureData) {
      setSubmitError('Please provide technician signature');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await onSubmit({
        technicianId: technician.id,
        technicianName: technician.name,
        technicianLocationId: technician.locationId,
        contractorId: technician.contractorId,
        contractorName: technician.contractorName,
        sourceLocationId: warehouseLocationId,
        projectId,
        serials: validSerials.map((s) => ({
          serialNumber: s.serialNumber,
          stockItemId: s.stockItemId || selectedItemId,
        })),
        signatureData,
        notes: notes || undefined,
      });

      // Success - close modal
      onClose();
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : 'Failed to submit checkout'
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    validSerials,
    signatureData,
    technician,
    warehouseLocationId,
    projectId,
    selectedItemId,
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
    setSignatureData(null);
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
            className="fixed inset-4 z-50 flex flex-col bg-white dark:bg-slate-900 rounded-2xl overflow-hidden md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[600px] md:max-h-[90vh]"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                  <UserCheck className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Daily Stock Checkout
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Issue to {technician.name}
                    {technician.contractorName && (
                      <span className="text-slate-400">
                        {' '}
                        ({technician.contractorName})
                      </span>
                    )}
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
              {/* Item Type Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Stock Item Type
                </label>
                <select
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent"
                >
                  {stockItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.itemCode})
                    </option>
                  ))}
                </select>
              </div>

              {/* Scan Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => setIsScannerOpen(true)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium"
                >
                  <Camera className="w-5 h-5" />
                  Scan {selectedItem?.name || 'Items'}
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
                        className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      />
                      <button
                        onClick={handleManualSubmit}
                        disabled={!manualEntry.trim()}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white rounded-lg transition-colors"
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
                    Ready to Issue
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

              {/* Scanned Serials List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Scanned Items ({validSerials.length})
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

                <div className="max-h-[150px] overflow-y-auto space-y-1 border border-slate-200 dark:border-slate-700 rounded-lg">
                  {scannedSerials.length === 0 ? (
                    <div className="p-6 text-center text-slate-500 dark:text-slate-400">
                      <Camera className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No serials scanned yet</p>
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
                            {serial.stockItemName && serial.isValid && (
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                {serial.stockItemName}
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

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Notes (Optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any notes about this checkout..."
                  rows={2}
                  className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
                />
              </div>

              {/* Signature */}
              <SignatureCanvas onSignatureChange={setSignatureData} />

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
                disabled={
                  isSubmitting || validSerials.length === 0 || !signatureData
                }
                className="flex items-center gap-2 px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white rounded-lg transition-colors font-medium"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4" />
                    Issue Stock ({validSerials.length})
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
            title={`Scan ${selectedItem?.name || 'Items'}`}
          />
        </>
      )}
    </AnimatePresence>
  );
}

export default DailyCheckoutModal;
