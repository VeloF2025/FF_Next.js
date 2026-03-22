'use client';

/**
 * AddAssetModal
 *
 * Three entry modes:
 * 1. Scan Label — VLM extracts serial/manufacturer/model from equipment label photo
 * 2. Scan Barcode — camera scans barcode/QR, populates barcode field (checks for duplicates)
 * 3. Manual Entry — standard form
 *
 * All modes land on the same form. Condition photos can be attached.
 */

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Loader2, ScanLine, ScanLine, PenLine,
  PackagePlus, Camera,
} from 'lucide-react';
import { LabelScanner } from './LabelScanner';
import { ConditionPhotoCapture, type CapturedPhoto } from './ConditionPhotoCapture';
import { BarcodeScannerModal } from '@/modules/barcode-scanner';
import { useCreateAsset } from '../hooks/mutations';
import { useCategories } from '../hooks/queries';
import { ASSET_CATEGORY_CONFIG } from '../constants/assetCategories';
import type { AssetLabelExtraction } from '../services/assetVlmService';
import type { Asset } from '../types/asset';
import type { CreateAssetInput } from '../utils/schemas';
import { log } from '@/lib/logger';

interface AddAssetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

type EntryMode = 'choose' | 'manual';

export function AddAssetModal({ isOpen, onClose, onCreated }: AddAssetModalProps) {
  const [mode, setMode] = useState<EntryMode>('choose');
  const [labelScannerOpen, setLabelScannerOpen] = useState(false);
  const [barcodeScannerOpen, setBarcodeScannerOpen] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [barcode, setBarcode] = useState('');
  const [description, setDescription] = useState('');
  const [currentLocation, setCurrentLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [conditionPhotos, setConditionPhotos] = useState<CapturedPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);

  // VLM extraction metadata (stored for audit)
  const [vlmData, setVlmData] = useState<AssetLabelExtraction | null>(null);

  const createAsset = useCreateAsset();
  const { data: categories } = useCategories({ isActive: true });

  // Reset when modal closes
  useEffect(() => {
    if (!isOpen) {
      setMode('choose');
      setLabelScannerOpen(false);
      setBarcodeScannerOpen(false);
      setName('');
      setCategoryId('');
      setSerialNumber('');
      setManufacturer('');
      setModel('');
      setBarcode('');
      setDescription('');
      setCurrentLocation('');
      setNotes('');
      setConditionPhotos([]);
      setError(null);
      setVlmData(null);
    }
  }, [isOpen]);

  // Handle VLM label extraction — pre-fill form fields
  const handleExtracted = useCallback((data: AssetLabelExtraction) => {
    setVlmData(data);
    if (data.serialNumber) setSerialNumber(data.serialNumber);
    if (data.manufacturer) setManufacturer(data.manufacturer);
    if (data.model) setModel(data.model);
    if (data.barcode) setBarcode(data.barcode);

    // Auto-generate a name from manufacturer + model
    const parts = [data.manufacturer, data.model].filter(Boolean);
    if (parts.length > 0) setName(parts.join(' '));

    setLabelScannerOpen(false);
    setMode('manual');
  }, []);

  // Handle barcode scan — if asset exists, warn; otherwise populate barcode field
  const handleBarcodeAssetFound = useCallback((asset: Asset) => {
    // Asset already registered — warn user
    setError(`This barcode is already registered to "${asset.name}" (${asset.assetNumber}). Check if this is a duplicate.`);
    setBarcode(asset.barcode || '');
    setBarcodeScannerOpen(false);
    setMode('manual');
  }, []);

  const handleBarcodeScannerClose = useCallback(() => {
    setBarcodeScannerOpen(false);
    // If barcode scanner didn't find an asset, that's fine — the user scanned
    // a new barcode. The barcode value isn't captured here since BarcodeScannerModal
    // only returns found assets. User can type it manually.
    if (mode === 'choose') setMode('manual');
  }, [mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !categoryId) return;

    // Check photos are all uploaded
    if (conditionPhotos.some(p => p.uploading)) {
      setError('Please wait for photos to finish uploading');
      return;
    }

    setError(null);

    const photoUrls = conditionPhotos
      .map(p => p.storageUrl)
      .filter((url): url is string => !!url);

    const payload: CreateAssetInput = {
      name: name.trim(),
      categoryId,
      serialNumber: serialNumber.trim() || undefined,
      manufacturer: manufacturer.trim() || undefined,
      model: model.trim() || undefined,
      barcode: barcode.trim() || undefined,
      description: description.trim() || undefined,
      currentLocation: currentLocation.trim() || undefined,
      notes: notes.trim() || undefined,
      primaryImageUrl: photoUrls[0] || undefined,
      vlmExtractionData: vlmData ? {
        manufacturer: vlmData.manufacturer,
        model: vlmData.model,
        serialNumber: vlmData.serialNumber,
        barcode: vlmData.barcode,
        confidence: vlmData.confidence,
        rawText: vlmData.rawText,
        conditionPhotoUrls: photoUrls,
      } : photoUrls.length > 0 ? { conditionPhotoUrls: photoUrls } : undefined,
    };

    try {
      await createAsset.mutateAsync(payload);
      onCreated?.();
      onClose();
    } catch (err) {
      log.error('Failed to create asset', { error: err }, 'AddAssetModal');
      setError(err instanceof Error ? err.message : 'Failed to create asset');
    }
  };

  if (!isOpen) return null;

  const inputCls = 'w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50';
  const labelCls = 'block text-sm font-medium text-[var(--ff-text-secondary)] mb-1';

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 flex items-center justify-center z-[10000]"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        {/* Modal */}
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-xl w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-[var(--ff-border-light)]">
            <div className="flex items-center gap-2">
              <PackagePlus className="h-5 w-5 text-blue-400" />
              <h2 className="text-base font-semibold text-[var(--ff-text-primary)]">
                {mode === 'choose' ? 'Add Asset' : vlmData ? 'Add Asset (Scanned)' : 'Add Asset'}
              </h2>
            </div>
            <button type="button" onClick={onClose} className="text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {/* Mode chooser */}
            {mode === 'choose' && (
              <div className="space-y-4">
                <p className="text-sm text-[var(--ff-text-secondary)] text-center mb-2">
                  How would you like to add this asset?
                </p>

                <div className="grid grid-cols-3 gap-3">
                  {/* Scan Label (VLM OCR) */}
                  <button
                    type="button"
                    onClick={() => { setLabelScannerOpen(true); }}
                    className="flex flex-col items-center gap-2 p-4 bg-[var(--ff-bg-tertiary)] hover:bg-blue-500/10 border border-[var(--ff-border-light)] hover:border-blue-500/50 rounded-xl transition-all"
                  >
                    <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                      <ScanLine className="w-5 h-5 text-blue-400" />
                    </div>
                    <span className="text-xs font-medium text-[var(--ff-text-primary)]">Scan Label</span>
                    <span className="text-[10px] text-[var(--ff-text-tertiary)] text-center leading-tight">
                      Photo of label — reads serial, make, model
                    </span>
                  </button>

                  {/* Scan Barcode */}
                  <button
                    type="button"
                    onClick={() => { setBarcodeScannerOpen(true); }}
                    className="flex flex-col items-center gap-2 p-4 bg-[var(--ff-bg-tertiary)] hover:bg-purple-500/10 border border-[var(--ff-border-light)] hover:border-purple-500/50 rounded-xl transition-all"
                  >
                    <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                      <ScanLine className="w-5 h-5 text-purple-400" />
                    </div>
                    <span className="text-xs font-medium text-[var(--ff-text-primary)]">Scan Barcode</span>
                    <span className="text-[10px] text-[var(--ff-text-tertiary)] text-center leading-tight">
                      Barcode or QR — checks for duplicates
                    </span>
                  </button>

                  {/* Manual Entry */}
                  <button
                    type="button"
                    onClick={() => setMode('manual')}
                    className="flex flex-col items-center gap-2 p-4 bg-[var(--ff-bg-tertiary)] hover:bg-green-500/10 border border-[var(--ff-border-light)] hover:border-green-500/50 rounded-xl transition-all"
                  >
                    <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                      <PenLine className="w-5 h-5 text-green-400" />
                    </div>
                    <span className="text-xs font-medium text-[var(--ff-text-primary)]">Manual Entry</span>
                    <span className="text-[10px] text-[var(--ff-text-tertiary)] text-center leading-tight">
                      Type in details by hand
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* Manual form (also shown after scan with pre-filled data) */}
            {mode === 'manual' && (
              <form onSubmit={handleSubmit} id="add-asset-form" className="space-y-4">
                {/* Quick-scan buttons if no VLM data yet */}
                {!vlmData && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setLabelScannerOpen(true)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-lg hover:bg-blue-500/15 transition-colors"
                    >
                      <ScanLine className="h-3.5 w-3.5" />
                      Scan Label
                    </button>
                    <button
                      type="button"
                      onClick={() => setBarcodeScannerOpen(true)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-purple-400 bg-purple-500/10 border border-purple-500/20 rounded-lg hover:bg-purple-500/15 transition-colors"
                    >
                      <ScanLine className="h-3.5 w-3.5" />
                      Scan Barcode
                    </button>
                  </div>
                )}

                {/* VLM confidence indicator */}
                {vlmData && (
                  <div className="flex items-center gap-2 px-3 py-2 text-xs bg-green-500/10 border border-green-500/20 rounded-lg">
                    <ScanLine className="h-3.5 w-3.5 text-green-400" />
                    <span className="text-green-400">
                      Scanned — {Math.round(vlmData.confidence * 100)}% confidence. Review and edit below.
                    </span>
                    <button
                      type="button"
                      onClick={() => setLabelScannerOpen(true)}
                      className="ml-auto text-blue-400 hover:text-blue-300"
                    >
                      Re-scan
                    </button>
                  </div>
                )}

                {error && (
                  <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
                )}

                {/* Name */}
                <div>
                  <label className={labelCls}>Asset Name <span className="text-red-400">*</span></label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={255}
                    placeholder="e.g. EXFO MaxTester 730C"
                    className={inputCls}
                  />
                </div>

                {/* Category */}
                <div>
                  <label className={labelCls}>Category <span className="text-red-400">*</span></label>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    required
                    className={inputCls}
                  >
                    <option value="">Select category...</option>
                    {categories?.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                        {cat.type && ASSET_CATEGORY_CONFIG[cat.type as keyof typeof ASSET_CATEGORY_CONFIG]
                          ? ` (${ASSET_CATEGORY_CONFIG[cat.type as keyof typeof ASSET_CATEGORY_CONFIG].label})`
                          : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Serial + Barcode */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Serial Number</label>
                    <input
                      type="text"
                      value={serialNumber}
                      onChange={(e) => setSerialNumber(e.target.value)}
                      maxLength={100}
                      placeholder="S/N"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Barcode</label>
                    <input
                      type="text"
                      value={barcode}
                      onChange={(e) => setBarcode(e.target.value)}
                      maxLength={100}
                      placeholder="Barcode"
                      className={inputCls}
                    />
                  </div>
                </div>

                {/* Manufacturer + Model */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Manufacturer</label>
                    <input
                      type="text"
                      value={manufacturer}
                      onChange={(e) => setManufacturer(e.target.value)}
                      maxLength={255}
                      placeholder="e.g. EXFO"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Model</label>
                    <input
                      type="text"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      maxLength={255}
                      placeholder="e.g. MaxTester 730C"
                      className={inputCls}
                    />
                  </div>
                </div>

                {/* Location */}
                <div>
                  <label className={labelCls}>Current Location</label>
                  <input
                    type="text"
                    value={currentLocation}
                    onChange={(e) => setCurrentLocation(e.target.value)}
                    maxLength={255}
                    placeholder="e.g. Warehouse A, Bay 3"
                    className={inputCls}
                  />
                </div>

                {/* Description */}
                <div>
                  <label className={labelCls}>Description <span className="text-xs text-[var(--ff-text-tertiary)]">(optional)</span></label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={2000}
                    rows={2}
                    placeholder="Additional details..."
                    className={inputCls + ' resize-none'}
                  />
                </div>

                {/* Condition Photos */}
                <ConditionPhotoCapture
                  photos={conditionPhotos}
                  onChange={setConditionPhotos}
                  storageCategory="condition-photos"
                  maxPhotos={4}
                  label="Condition Photos"
                  helperText="Photograph the equipment's current state for the record"
                />

                {/* Notes */}
                <div>
                  <label className={labelCls}>Notes <span className="text-xs text-[var(--ff-text-tertiary)]">(optional)</span></label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={5000}
                    rows={2}
                    placeholder="Internal notes..."
                    className={inputCls + ' resize-none'}
                  />
                </div>
              </form>
            )}
          </div>

          {/* Footer */}
          {mode === 'manual' && (
            <div className="flex justify-end gap-3 p-5 border-t border-[var(--ff-border-light)]">
              <button
                type="button"
                onClick={() => vlmData ? setMode('choose') : onClose()}
                className="px-4 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
              >
                {vlmData ? 'Back' : 'Cancel'}
              </button>
              <button
                type="submit"
                form="add-asset-form"
                disabled={!name.trim() || !categoryId || createAsset.isPending || conditionPhotos.some(p => p.uploading)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {createAsset.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
                Add Asset
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Label Scanner overlay (VLM OCR) */}
      <LabelScanner
        isOpen={labelScannerOpen}
        onClose={() => {
          setLabelScannerOpen(false);
          if (!vlmData && mode === 'choose') { /* stay on choose */ }
        }}
        mode="extract"
        onExtracted={handleExtracted}
        title="Scan Asset Label"
      />

      {/* Barcode Scanner overlay */}
      <BarcodeScannerModal
        isOpen={barcodeScannerOpen}
        onClose={handleBarcodeScannerClose}
        onAssetFound={handleBarcodeAssetFound}
        title="Scan Asset Barcode"
      />
    </>,
    document.body,
  );
}

export default AddAssetModal;
