'use client';

/**
 * Checkin Client Component
 * Handles asset return form
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ArrowLeft, Loader2, Package, User, ScanLine } from 'lucide-react';
import type { Asset } from '@/modules/assets/types';

// Dynamic import for barcode scanner (client-side only)
const BarcodeScannerModal = dynamic(
  () => import('@/modules/barcode-scanner/components/BarcodeScannerModal').then(mod => mod.default),
  { ssr: false, loading: () => null }
);

interface CheckinClientProps {
  assets: Asset[];
  preselectedAssetId?: string;
}

type Condition = 'new' | 'excellent' | 'good' | 'fair' | 'poor' | 'damaged';

const CONDITIONS: { value: Condition; label: string; color: string }[] = [
  { value: 'new', label: 'New', color: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' },
  { value: 'excellent', label: 'Excellent', color: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' },
  { value: 'good', label: 'Good', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300' },
  { value: 'fair', label: 'Fair', color: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300' },
  { value: 'poor', label: 'Poor', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300' },
  { value: 'damaged', label: 'Damaged', color: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' },
];

export function CheckinClient({ assets, preselectedAssetId }: CheckinClientProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);

  const [formData, setFormData] = useState({
    assetId: preselectedAssetId || '',
    condition: 'good' as Condition,
    newLocation: '',
    notes: '',
  });

  const selectedAsset = assets.find((a) => a.id === formData.assetId);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  // Handle asset found from barcode scanner
  function handleAssetScanned(asset: Asset) {
    if (asset.status !== 'assigned') {
      setError(`Asset "${asset.name}" is not checked out (status: ${asset.status}).`);
      return;
    }
    setFormData((prev) => ({ ...prev, assetId: asset.id }));
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const payload: Record<string, any> = {
        conditionAtCheckin: formData.condition,
      };

      if (formData.newLocation) payload.newLocation = formData.newLocation;
      if (formData.notes) payload.checkinNotes = formData.notes;

      const response = await fetch(`/api/assets/${formData.assetId}/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to check in asset');
      }

      router.push(`/inventory/${formData.assetId}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6 space-y-6">
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      {assets.length === 0 ? (
        <div className="text-center py-8">
          <Package className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
          <p className="text-gray-500 dark:text-gray-400">No assets are currently checked out</p>
        </div>
      ) : (
        <>
          {/* Asset Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Select Asset to Return *
            </label>
            <div className="flex gap-2">
              <select
                name="assetId"
                value={formData.assetId}
                onChange={handleChange}
                required
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Choose an asset...</option>
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.assetNumber} - {asset.name}
                    {asset.currentAssigneeName && ` (with ${asset.currentAssigneeName})`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors flex items-center gap-2"
                title="Scan barcode"
              >
                <ScanLine className="h-5 w-5" />
                <span className="hidden sm:inline">Scan</span>
              </button>
            </div>
          </div>

          {/* Selected Asset Info */}
          {selectedAsset && (
            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="flex items-start space-x-4">
                <div className="h-12 w-12 bg-white dark:bg-gray-600 rounded-lg flex items-center justify-center">
                  <Package className="h-6 w-6 text-gray-400 dark:text-gray-500" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-gray-900 dark:text-white">{selectedAsset.name}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {selectedAsset.manufacturer} {selectedAsset.model}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 font-mono mt-1">
                    {selectedAsset.assetNumber}
                  </p>
                </div>
              </div>

              {selectedAsset.currentAssigneeName && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-600 flex items-center space-x-3">
                  <div className="h-8 w-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                    <User className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      Currently with: {selectedAsset.currentAssigneeName}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                      {selectedAsset.currentAssigneeType}
                      {selectedAsset.assignedSince &&
                        ` since ${new Date(selectedAsset.assignedSince).toLocaleDateString()}`}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Condition */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Condition on Return *
            </label>
            <div className="grid grid-cols-3 gap-3">
              {CONDITIONS.map((cond) => (
                <button
                  key={cond.value}
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, condition: cond.value }))}
                  className={`p-3 border rounded-lg text-center transition-colors ${
                    formData.condition === cond.value
                      ? `border-blue-500 ${cond.color}`
                      : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  <span className="text-sm font-medium">{cond.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* New Location */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Return Location
            </label>
            <input
              type="text"
              name="newLocation"
              value={formData.newLocation}
              onChange={handleChange}
              placeholder="e.g., Warehouse A, Bin 12"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Check-in Notes
            </label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows={3}
              placeholder="Any notes about the condition or usage..."
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Submit */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6 flex justify-end space-x-4">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-6 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !formData.assetId}
              className="inline-flex items-center px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Check In Asset
                </>
              )}
            </button>
          </div>
        </>
      )}

      {/* Barcode Scanner Modal - only render when open */}
      {scannerOpen && (
        <BarcodeScannerModal
          isOpen={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onAssetFound={handleAssetScanned}
          title="Scan Asset to Check In"
          filterByStatus={['assigned']}
        />
      )}
    </form>
  );
}
