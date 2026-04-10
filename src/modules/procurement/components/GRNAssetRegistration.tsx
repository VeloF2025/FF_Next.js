'use client';

/**
 * GRN Asset Registration Panel
 *
 * Shows after GRN completion to register received items as assets.
 * Supports:
 * - Serial number entry for each item
 * - Label scanning via VLM
 * - Category selection
 * - Batch registration
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Package,
  Scan,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';
import { LabelScanner } from '@/modules/assets/components/LabelScanner';

// ============================================================================
// TYPES
// ============================================================================

interface RegistrableItem {
  grnItemId: string;
  stockItemId: string | null;
  itemCode: string | null;
  itemDescription: string;
  quantityReceived: number;
  quantityAccepted: number;
  unitCost: number | null;
  uom: string;
  serialNumbers: string[];
  lotNumber: string | null;
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
  requiresRegistration: boolean;
  registeredCount: number;
}

interface GrnData {
  id: string;
  grnNumber: string;
  status: string;
  deliveryDate: string;
  supplier: { id: number; name: string };
  po: { id: string; number: string } | null;
  warehouse: { id: string; name: string };
}

interface AssetCategory {
  id: string;
  name: string;
  code: string;
}

interface RegistrationEntry {
  grnItemId: string;
  serialNumber: string;
  categoryId: string;
  name?: string;
  manufacturer?: string;
  model?: string;
  labelImageUrl?: string;
}

interface GRNAssetRegistrationProps {
  grnId: string;
  onComplete?: () => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function GRNAssetRegistration({ grnId, onComplete }: GRNAssetRegistrationProps) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [grn, setGrn] = useState<GrnData | null>(null);
  const [items, setItems] = useState<RegistrableItem[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);

  const [entries, setEntries] = useState<Record<string, RegistrationEntry[]>>({});
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanningItemId, setScanningItemId] = useState<string | null>(null);
  const [scanningEntryIndex, setScanningEntryIndex] = useState<number | null>(null);

  const [result, setResult] = useState<{
    success: boolean;
    registered: number;
    skipped: number;
    errors: number;
  } | null>(null);

  // Load GRN data and categories
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError(null);

      try {
        const [grnRes, catRes] = await Promise.all([
          fetch(`/api/procurement/grn/${grnId}/register-assets`),
          fetch('/api/assets/categories'),
        ]);

        if (!grnRes.ok) {
          throw new Error('Failed to load GRN data');
        }

        const grnData = await grnRes.json();
        setGrn(grnData.data.grn);
        setItems(grnData.data.items);

        // Initialize entries for each item
        const initialEntries: Record<string, RegistrationEntry[]> = {};
        grnData.data.items.forEach((item: RegistrableItem) => {
          const pending = item.quantityAccepted - item.registeredCount;
          if (pending > 0) {
            // Pre-populate with serial numbers if available
            const serials = item.serialNumbers.slice(item.registeredCount, item.quantityAccepted);
            initialEntries[item.grnItemId] = serials.length > 0
              ? serials.map((sn) => ({
                  grnItemId: item.grnItemId,
                  serialNumber: sn,
                  categoryId: item.suggestedCategoryId || '',
                }))
              : [{ grnItemId: item.grnItemId, serialNumber: '', categoryId: item.suggestedCategoryId || '' }];
          }
        });
        setEntries(initialEntries);

        // Expand items that have pending registrations
        setExpandedItems(new Set(Object.keys(initialEntries)));

        if (catRes.ok) {
          const catData = await catRes.json();
          setCategories(catData.data || []);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [grnId]);

  // Toggle item expansion
  const toggleExpand = useCallback((itemId: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  // Add entry for an item
  const addEntry = useCallback((itemId: string) => {
    const item = items.find((i) => i.grnItemId === itemId);
    setEntries((prev) => ({
      ...prev,
      [itemId]: [
        ...(prev[itemId] || []),
        { grnItemId: itemId, serialNumber: '', categoryId: item?.suggestedCategoryId || '' },
      ],
    }));
  }, [items]);

  // Remove entry
  const removeEntry = useCallback((itemId: string, index: number) => {
    setEntries((prev) => ({
      ...prev,
      [itemId]: prev[itemId]!.filter((_, i) => i !== index),
    }));
  }, []);

  // Update entry field
  const updateEntry = useCallback(
    (itemId: string, index: number, field: keyof RegistrationEntry, value: string) => {
      setEntries((prev) => ({
        ...prev,
        [itemId]: prev[itemId]!.map((entry, i) =>
          i === index ? { ...entry, [field]: value } : entry
        ),
      }));
    },
    []
  );

  // Open scanner for an entry
  const openScanner = useCallback((itemId: string, entryIndex: number) => {
    setScanningItemId(itemId);
    setScanningEntryIndex(entryIndex);
    setScannerOpen(true);
  }, []);

  // Handle scan result
  const handleScanResult = useCallback(
    (extraction: { serialNumber?: string | null; manufacturer?: string | null; model?: string | null }) => {
      if (scanningItemId && scanningEntryIndex !== null) {
        setEntries((prev) => ({
          ...prev,
          [scanningItemId]: prev[scanningItemId]!.map((entry, i) =>
            i === scanningEntryIndex
              ? {
                  ...entry,
                  serialNumber: extraction.serialNumber || entry.serialNumber,
                  manufacturer: extraction.manufacturer || entry.manufacturer,
                  model: extraction.model || entry.model,
                }
              : entry
          ),
        }));
      }
      setScannerOpen(false);
      setScanningItemId(null);
      setScanningEntryIndex(null);
    },
    [scanningItemId, scanningEntryIndex]
  );

  // Submit registration
  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      // Flatten entries and filter valid ones
      const allEntries = Object.values(entries)
        .flat()
        .filter((e) => e.serialNumber && e.categoryId);

      if (allEntries.length === 0) {
        setError('No valid entries to register. Please add serial numbers and categories.');
        return;
      }

      const response = await fetch(`/api/procurement/grn/${grnId}/register-assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: allEntries }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
      }

      setResult(data.data.summary);

      // Refresh data if some were registered
      if (data.data.summary.registered > 0) {
        const grnRes = await fetch(`/api/procurement/grn/${grnId}/register-assets`);
        if (grnRes.ok) {
          const grnData = await grnRes.json();
          setItems(grnData.data.items);
        }
        onComplete?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  }, [entries, grnId, onComplete]);

  // Count total entries
  const totalEntries = Object.values(entries).flat().filter((e) => e.serialNumber && e.categoryId).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <LoadingSpinner size="md" label="Loading registration data..." />
      </div>
    );
  }

  if (error && !grn) {
    return (
      <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg">
        <div className="flex items-center gap-2 text-red-400">
          <AlertTriangle className="w-5 h-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!grn || items.length === 0) {
    return (
      <div className="p-4 bg-slate-800 border border-slate-700 rounded-lg">
        <div className="flex items-center gap-2 text-slate-400">
          <Package className="w-5 h-5" />
          <span>No items require asset registration for this GRN.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-400" />
            Asset Registration
          </h3>
          <p className="text-sm text-slate-400 mt-1">
            Register received items as tracked assets • GRN: {grn.grnNumber}
          </p>
        </div>
        {totalEntries > 0 && (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white rounded-lg font-medium flex items-center gap-2"
          >
            {submitting ? (
              <InlineSpinner size="sm" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            Register {totalEntries} Asset{totalEntries !== 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* Result message */}
      {result && (
        <div
          className={`p-4 rounded-lg border ${
            result.errors === 0
              ? 'bg-green-900/30 border-green-700'
              : 'bg-yellow-900/30 border-yellow-700'
          }`}
        >
          <div className="flex items-center gap-2">
            {result.errors === 0 ? (
              <CheckCircle2 className="w-5 h-5 text-green-400" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
            )}
            <span className={result.errors === 0 ? 'text-green-400' : 'text-yellow-400'}>
              Registered: {result.registered} • Skipped: {result.skipped} • Errors: {result.errors}
            </span>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Items list */}
      <div className="space-y-3">
        {items.map((item) => {
          const pending = item.quantityAccepted - item.registeredCount;
          const isExpanded = expandedItems.has(item.grnItemId);
          const itemEntries = entries[item.grnItemId] || [];

          return (
            <div
              key={item.grnItemId}
              className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden"
            >
              {/* Item header */}
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-750"
                onClick={() => toggleExpand(item.grnItemId)}
              >
                <div className="flex-1">
                  <p className="text-white font-medium">{item.itemDescription}</p>
                  <p className="text-sm text-slate-400">
                    {item.itemCode && <span className="mr-2">{item.itemCode}</span>}
                    Qty: {item.quantityAccepted} {item.uom}
                    {item.registeredCount > 0 && (
                      <span className="ml-2 text-green-400">
                        ({item.registeredCount} registered)
                      </span>
                    )}
                    {pending > 0 && (
                      <span className="ml-2 text-yellow-400">({pending} pending)</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {item.suggestedCategoryName && (
                    <span className="px-2 py-1 bg-slate-700 text-slate-300 text-xs rounded">
                      {item.suggestedCategoryName}
                    </span>
                  )}
                  {isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </div>
              </div>

              {/* Expanded entries */}
              {isExpanded && (
                <div className="border-t border-slate-700 p-4 space-y-3">
                  {itemEntries.map((entry, index) => (
                    <div key={index} className="flex items-center gap-3">
                      {/* Serial number */}
                      <div className="flex-1">
                        <input
                          type="text"
                          placeholder="Serial Number"
                          value={entry.serialNumber}
                          onChange={(e) =>
                            updateEntry(item.grnItemId, index, 'serialNumber', e.target.value)
                          }
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                        />
                      </div>

                      {/* Category select */}
                      <select
                        value={entry.categoryId}
                        onChange={(e) =>
                          updateEntry(item.grnItemId, index, 'categoryId', e.target.value)
                        }
                        className="px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                      >
                        <option value="">Select Category</option>
                        {categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.code} - {cat.name}
                          </option>
                        ))}
                      </select>

                      {/* Scan button */}
                      <button
                        onClick={() => openScanner(item.grnItemId, index)}
                        className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg"
                        title="Scan label"
                      >
                        <Scan className="w-5 h-5 text-blue-400" />
                      </button>

                      {/* Remove button */}
                      {itemEntries.length > 1 && (
                        <button
                          onClick={() => removeEntry(item.grnItemId, index)}
                          className="p-2 bg-slate-700 hover:bg-red-700 rounded-lg"
                          title="Remove"
                        >
                          <Trash2 className="w-5 h-5 text-slate-400" />
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Add more button */}
                  {itemEntries.length < pending && (
                    <button
                      onClick={() => addEntry(item.grnItemId)}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-blue-400 hover:text-blue-300"
                    >
                      <Plus className="w-4 h-4" />
                      Add another serial
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Label Scanner Modal */}
      <LabelScanner
        isOpen={scannerOpen}
        onClose={() => {
          setScannerOpen(false);
          setScanningItemId(null);
          setScanningEntryIndex(null);
        }}
        mode="extract"
        onExtracted={handleScanResult}
        title="Scan Asset Label"
      />
    </div>
  );
}

export default GRNAssetRegistration;
