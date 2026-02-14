/**
 * ConsumptionRecorder Component
 * Mobile-optimized interface for recording material consumption on jobs
 */

'use client';

import { useState } from 'react';
import { Package, Check, X, Loader2, AlertCircle, Plus, Trash2 } from 'lucide-react';
import { useConsumptions, useStockItems } from '../../hooks';
import { SerialScanner } from '../serials/SerialScanner';
import type { StockSerial, StockItem, RecordConsumptionInput } from '../../types';

interface ConsumptionItem {
  id: string;
  stockItemId: string;
  itemCode: string;
  itemName: string;
  quantity: number;
  serialId?: string;
  serialNumber?: string;
  trackingType: 'serial' | 'quantity' | 'lot' | 'drum';
}

interface ConsumptionRecorderProps {
  dropNumber?: string;
  dropId?: string;
  homeInstallId?: string;
  technicianId: string;
  technicianName: string;
  technicianLocationId: string;
  onComplete?: (consumptions: ConsumptionItem[]) => void;
  onCancel?: () => void;
}

export function ConsumptionRecorder({
  dropNumber,
  dropId,
  homeInstallId,
  technicianId,
  technicianName,
  technicianLocationId,
  onComplete,
  onCancel,
}: ConsumptionRecorderProps) {
  const [items, setItems] = useState<ConsumptionItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<StockItem | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [showSerialScanner, setShowSerialScanner] = useState(false);

  const { items: stockItems, loading: loadingItems } = useStockItems({ autoFetch: true });
  const { recordConsumption } = useConsumptions({ autoFetch: false });

  const jobType = dropNumber ? 'drop' : 'home_install';
  const jobReference = dropNumber || homeInstallId || 'Unknown';

  const handleAddSerialItem = (serial: StockSerial) => {
    const newItem: ConsumptionItem = {
      id: crypto.randomUUID(),
      stockItemId: serial.stockItemId,
      itemCode: serial.itemCode || '',
      itemName: serial.itemName || 'Unknown Item',
      quantity: 1,
      serialId: serial.id,
      serialNumber: serial.serialNumber,
      trackingType: 'serial',
    };

    setItems([...items, newItem]);
    setShowSerialScanner(false);
  };

  const handleAddQuantityItem = () => {
    if (!selectedItem) return;

    const newItem: ConsumptionItem = {
      id: crypto.randomUUID(),
      stockItemId: selectedItem.id,
      itemCode: selectedItem.itemCode,
      itemName: selectedItem.name,
      quantity,
      trackingType: selectedItem.trackingType,
    };

    setItems([...items, newItem]);
    setSelectedItem(null);
    setQuantity(1);
    setShowItemPicker(false);
  };

  const handleRemoveItem = (id: string) => {
    setItems(items.filter((item) => item.id !== id));
  };

  const handleSubmit = async () => {
    if (items.length === 0) {
      setError('Add at least one item to record consumption');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      for (const item of items) {
        const input: RecordConsumptionInput = {
          jobType,
          dropId: dropId || undefined,
          dropNumber: dropNumber || undefined,
          homeInstallId: homeInstallId || undefined,
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          serialId: item.serialId,
          serialNumber: item.serialNumber,
          consumedById: technicianId,
          consumedByName: technicianName,
          consumedFromLocationId: technicianLocationId,
        };

        await recordConsumption(input);
      }

      onComplete?.(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record consumption');
    } finally {
      setSubmitting(false);
    }
  };

  const serialItems = stockItems.filter((item) => item.trackingType === 'serial');
  const quantityItems = stockItems.filter((item) => item.trackingType !== 'serial');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4 dark:border-gray-700 dark:bg-gray-800">
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Recording consumption for</p>
        <p className="text-lg font-bold text-gray-900 dark:text-white">{jobReference}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Technician: {technicianName}
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-500" />
          <div>
            <p className="text-sm font-medium text-red-800 dark:text-red-200">Error</p>
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        </div>
      )}

      {/* Add Items Section */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Add Materials</h3>

        {/* Serial Scanner */}
        {showSerialScanner ? (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-4 flex items-center justify-between">
              <h4 className="font-medium text-gray-900 dark:text-white">Scan Serial Number</h4>
              <button
                onClick={() => setShowSerialScanner(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SerialScanner
              onSerialSelected={handleAddSerialItem}
              locationId={technicianLocationId}
              allowedStatuses={['issued']}
              placeholder="Enter ONT, Router, or UPS serial..."
            />
          </div>
        ) : showItemPicker ? (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-4 flex items-center justify-between">
              <h4 className="font-medium text-gray-900 dark:text-white">Add Quantity Item</h4>
              <button
                onClick={() => setShowItemPicker(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {loadingItems ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
              </div>
            ) : (
              <div className="space-y-4">
                <select
                  value={selectedItem?.id || ''}
                  onChange={(e) => {
                    const item = quantityItems.find((i) => i.id === e.target.value);
                    setSelectedItem(item || null);
                  }}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-2 px-3 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                >
                  <option value="">Select item...</option>
                  {quantityItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.itemCode} - {item.name}
                    </option>
                  ))}
                </select>

                {selectedItem && (
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                        Quantity ({selectedItem.uom})
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={quantity}
                        onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-2 px-3 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                    <button
                      onClick={handleAddQuantityItem}
                      className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <button
              onClick={() => setShowSerialScanner(true)}
              className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 p-6 text-gray-600 dark:text-gray-400 hover:border-blue-500 hover:bg-blue-50 hover:text-blue-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-blue-500 dark:hover:bg-blue-900/20 dark:hover:text-blue-400"
            >
              <Plus className="h-5 w-5" />
              <span className="font-medium">Scan Serial (ONT/Router/UPS)</span>
            </button>

            <button
              onClick={() => setShowItemPicker(true)}
              className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 p-6 text-gray-600 dark:text-gray-400 hover:border-green-500 hover:bg-green-50 hover:text-green-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-green-500 dark:hover:bg-green-900/20 dark:hover:text-green-400"
            >
              <Plus className="h-5 w-5" />
              <span className="font-medium">Add Quantity Item</span>
            </button>
          </div>
        )}
      </div>

      {/* Items List */}
      {items.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Materials to Record ({items.length})
          </h3>
          <div className="divide-y divide-gray-200 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-gray-100 dark:bg-gray-800 p-2 dark:bg-gray-700">
                    <Package className="h-5 w-5 text-gray-600 dark:text-gray-300" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{item.itemName}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {item.serialNumber ? (
                        <span className="font-mono">{item.serialNumber}</span>
                      ) : (
                        `${item.quantity}x ${item.itemCode}`
                      )}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveItem(item.id)}
                  className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-4">
        <button
          onClick={onCancel}
          disabled={submitting}
          className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:bg-gray-900 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={items.length === 0 || submitting}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 py-3 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Recording...
            </>
          ) : (
            <>
              <Check className="h-4 w-4" />
              Record Consumption
            </>
          )}
        </button>
      </div>
    </div>
  );
}
