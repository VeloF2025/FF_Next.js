/**
 * CreatePickingForm Component
 * Form for creating new stock pickings (issue, transfer, etc.)
 */

'use client';

import { useState, useEffect } from 'react';
import {
  Package,
  Plus,
  Trash2,
  AlertCircle,
  Check,
  ArrowRight
} from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { usePickings } from '../../hooks/usePickings';
import { useLocations } from '../../hooks/useLocations';
import { useStockItems } from '../../hooks/useStockItems';
import { SignatureCapture } from './SignatureCapture';
import type {
  CreatePickingInput,
  PickingType,
  StockLocation,
} from '../../types';

interface PickingLineForm {
  id: string;
  stockItemId: string;
  plannedQuantity: number;
  serialIds?: string[];
  notes?: string;
}

interface CreatePickingFormProps {
  pickingType?: PickingType;
  sourceLocationId?: string;
  destinationLocationId?: string;
  contractorId?: string;
  contractorName?: string;
  technicianId?: string;
  technicianName?: string;
  onSuccess?: (pickingId: string) => void;
  onCancel?: () => void;
}

export function CreatePickingForm({
  pickingType: defaultType = 'issue',
  sourceLocationId: defaultSourceId,
  destinationLocationId: defaultDestId,
  contractorId,
  contractorName,
  technicianId,
  technicianName,
  onSuccess,
  onCancel
}: CreatePickingFormProps) {
  const { createPicking, signPicking } = usePickings();
  const { locations, loading: loadingLocations } = useLocations({ autoFetch: true });
  const { items: stockItems, loading: _loadingItems } = useStockItems({ autoFetch: true });

  const [pickingType, setPickingType] = useState<PickingType>(defaultType);
  const [sourceLocationId, setSourceLocationId] = useState(defaultSourceId || '');
  const [destinationLocationId, setDestinationLocationId] = useState(defaultDestId || '');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PickingLineForm[]>([]);
  const [showSignature, setShowSignature] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdPickingId, setCreatedPickingId] = useState<string | null>(null);

  // Auto-select locations based on picking type
  useEffect(() => {
    if (pickingType === 'issue' && locations.length > 0) {
      // For issues, source is typically warehouse
      const warehouse = locations.find(l => l.locationType === 'warehouse');
      if (warehouse && !sourceLocationId) {
        setSourceLocationId(warehouse.id);
      }
    }
  }, [pickingType, locations, sourceLocationId]);

  const addLine = () => {
    setLines([
      ...lines,
      {
        id: crypto.randomUUID(),
        stockItemId: '',
        plannedQuantity: 1
      }
    ]);
  };

  const updateLine = (id: string, updates: Partial<PickingLineForm>) => {
    setLines(lines.map(line =>
      line.id === id ? { ...line, ...updates } : line
    ));
  };

  const removeLine = (id: string) => {
    setLines(lines.filter(line => line.id !== id));
  };

  const validateForm = (): string | null => {
    if (!sourceLocationId) return 'Please select a source location';
    if (!destinationLocationId) return 'Please select a destination location';
    if (sourceLocationId === destinationLocationId) {
      return 'Source and destination locations must be different';
    }
    if (lines.length === 0) return 'Please add at least one item';

    for (const line of lines) {
      if (!line.stockItemId) return 'Please select an item for all lines';
      if (line.plannedQuantity <= 0) return 'Quantity must be greater than 0';
    }

    return null;
  };

  const handleSubmit = async () => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const input: CreatePickingInput = {
        pickingType,
        sourceLocationId,
        destinationLocationId,
        contractorId,
        contractorName,
        technicianId,
        technicianName,
        notes: notes || undefined,
        lines: lines.map(line => ({
          stockItemId: line.stockItemId,
          plannedQuantity: line.plannedQuantity,
          serialIds: line.serialIds,
          notes: line.notes
        }))
      };

      const picking = await createPicking(input);
      setCreatedPickingId(picking.id);

      // Show signature capture for issue pickings
      if (pickingType === 'issue') {
        setShowSignature(true);
      } else {
        onSuccess?.(picking.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create transfer');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSign = async (signatureData: string, signedBy: string) => {
    if (!createdPickingId) return;

    setSubmitting(true);
    try {
      await signPicking(createdPickingId, { signatureData, signedBy });
      onSuccess?.(createdPickingId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign transfer');
    } finally {
      setSubmitting(false);
    }
  };

  const getLocationsByType = (type: 'source' | 'destination'): StockLocation[] => {
    // Filter locations based on picking type
    return locations.filter(location => {
      if (!location.isActive) return false;

      if (pickingType === 'issue') {
        if (type === 'source') {
          return location.locationType === 'warehouse' || location.locationType === 'site_store';
        } else {
          return location.locationType === 'technician' || location.locationType === 'site_store';
        }
      }

      if (pickingType === 'receipt') {
        if (type === 'source') {
          return location.locationType === 'transit';
        } else {
          return location.locationType === 'warehouse' || location.locationType === 'site_store';
        }
      }

      // For transfer, allow any active location
      return true;
    });
  };

  if (showSignature) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
          <div className="flex items-center gap-3">
            <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
            <div>
              <p className="font-medium text-green-800 dark:text-green-200">
                Transfer Created Successfully
              </p>
              <p className="text-sm text-green-700 dark:text-green-300">
                Please sign below to confirm receipt of materials.
              </p>
            </div>
          </div>
        </div>

        <SignatureCapture
          onSave={handleSign}
          onCancel={() => onSuccess?.(createdPickingId!)}
          signerName={technicianName || contractorName || ''}
        />

        {error && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-500" />
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-500" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Picking Type */}
      <div>
        <label className="mb-1 block text-sm font-medium text-muted-foreground">
          Transfer Type
        </label>
        <select
          value={pickingType}
          onChange={(e) => setPickingType(e.target.value as PickingType)}
          className="w-full rounded-lg border border-border bg-card py-2 px-3 text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          <option value="issue">Issue to Technician</option>
          <option value="transfer">Transfer Between Locations</option>
          <option value="receipt">Receipt from Supplier</option>
          <option value="return">Return to Warehouse</option>
          <option value="scrap">Scrap/Dispose</option>
        </select>
      </div>

      {/* Locations */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-muted-foreground">
            Source Location
          </label>
          <select
            value={sourceLocationId}
            onChange={(e) => setSourceLocationId(e.target.value)}
            disabled={loadingLocations}
            className="w-full rounded-lg border border-border bg-card py-2 px-3 text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          >
            <option value="">Select source...</option>
            {getLocationsByType('source').map(loc => (
              <option key={loc.id} value={loc.id}>
                {loc.code} - {loc.name} ({loc.locationType})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end gap-2">
          <ArrowRight className="hidden h-5 w-5 text-gray-400 sm:block" />
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium text-muted-foreground">
              Destination Location
            </label>
            <select
              value={destinationLocationId}
              onChange={(e) => setDestinationLocationId(e.target.value)}
              disabled={loadingLocations}
              className="w-full rounded-lg border border-border bg-card py-2 px-3 text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            >
              <option value="">Select destination...</option>
              {getLocationsByType('destination').map(loc => (
                <option key={loc.id} value={loc.id}>
                  {loc.code} - {loc.name} ({loc.locationType})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Contractor/Technician Info */}
      {(contractorName || technicianName) && (
        <div className="rounded-lg border border-border bg-background p-4 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-sm text-muted-foreground">Issuing to:</p>
          <p className="font-medium text-foreground">
            {technicianName || contractorName}
          </p>
        </div>
      )}

      {/* Items Section */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-muted-foreground">
            Items ({lines.length})
          </label>
          <button
            onClick={addLine}
            className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
          >
            <Plus className="h-4 w-4" />
            Add Item
          </button>
        </div>

        {lines.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-border bg-background p-8 text-center dark:border-gray-600 dark:bg-gray-800">
            <Package className="mx-auto h-10 w-10 text-gray-400" />
            <p className="mt-2 text-sm text-muted-foreground">
              No items added yet. Click &quot;Add Item&quot; to start.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {lines.map((line, _index) => (
              <div
                key={line.id}
                className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="flex-1 grid gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Item
                    </label>
                    <select
                      value={line.stockItemId}
                      onChange={(e) => updateLine(line.id, { stockItemId: e.target.value })}
                      className="w-full rounded-lg border border-border bg-card py-2 px-3 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    >
                      <option value="">Select item...</option>
                      {stockItems.map(item => (
                        <option key={item.id} value={item.id}>
                          {item.itemCode} - {item.name}
                          {item.trackingType === 'serial' && ' (Serial)'}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Quantity
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={line.plannedQuantity}
                      onChange={(e) => updateLine(line.id, {
                        plannedQuantity: Math.max(1, parseInt(e.target.value) || 1)
                      })}
                      className="w-full rounded-lg border border-border bg-card py-2 px-3 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                </div>

                <button
                  onClick={() => removeLine(line.id)}
                  className="mt-6 rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notes */}
      <div>
        <label className="mb-1 block text-sm font-medium text-muted-foreground">
          Notes (Optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Any additional notes..."
          className="w-full rounded-lg border border-border bg-card py-2 px-3 text-foreground placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
        />
      </div>

      {/* Action Buttons */}
      <div className="flex gap-4">
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 rounded-lg border border-border bg-card py-3 text-sm font-medium text-muted-foreground hover:bg-background disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleSubmit}
          disabled={submitting || lines.length === 0}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? (
            <>
              <InlineSpinner size="sm" />
              Creating...
            </>
          ) : (
            <>
              <Check className="h-4 w-4" />
              Create Transfer
            </>
          )}
        </button>
      </div>
    </div>
  );
}
