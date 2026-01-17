'use client';

/**
 * Maintenance Form Client Component
 * Handles scheduling maintenance form
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Save,
  Loader2,
  Package,
  Gauge,
  ShieldCheck,
  Wrench,
  Eye,
  Award,
} from 'lucide-react';
import type { Asset } from '@/modules/assets/types';

interface MaintenanceFormClientProps {
  assets: Asset[];
  preselectedAssetId?: string;
  preselectedType?: string;
}

type MaintenanceType = 'calibration' | 'preventive' | 'corrective' | 'inspection' | 'certification';

const MAINTENANCE_TYPES: { value: MaintenanceType; label: string; description: string; Icon: typeof Gauge }[] = [
  { value: 'calibration', label: 'Calibration', description: 'Required for test equipment accuracy', Icon: Gauge },
  { value: 'preventive', label: 'Preventive', description: 'Scheduled preventive maintenance', Icon: ShieldCheck },
  { value: 'corrective', label: 'Corrective', description: 'Repair after failure or damage', Icon: Wrench },
  { value: 'inspection', label: 'Inspection', description: 'Regular inspection check', Icon: Eye },
  { value: 'certification', label: 'Certification', description: 'Re-certification requirement', Icon: Award },
];

export function MaintenanceFormClient({
  assets,
  preselectedAssetId,
  preselectedType,
}: MaintenanceFormClientProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    assetId: preselectedAssetId || '',
    maintenanceType: (preselectedType as MaintenanceType) || 'preventive',
    scheduledDate: '',
    dueDate: '',
    providerName: '',
    providerContact: '',
    description: '',
    notes: '',
  });

  const selectedAsset = assets.find((a) => a.id === formData.assetId);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  function handleTypeSelect(type: MaintenanceType) {
    setFormData((prev) => ({ ...prev, maintenanceType: type }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const payload: Record<string, any> = {
        assetId: formData.assetId,
        maintenanceType: formData.maintenanceType,
        scheduledDate: formData.scheduledDate,
      };

      if (formData.dueDate) payload.dueDate = formData.dueDate;
      if (formData.providerName) payload.providerName = formData.providerName;
      if (formData.providerContact) payload.providerContact = formData.providerContact;
      if (formData.description) payload.description = formData.description;
      if (formData.notes) payload.notes = formData.notes;

      const response = await fetch('/api/assets/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to schedule maintenance');
      }

      router.push('/inventory/maintenance');
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

      {/* Asset Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Select Asset *
        </label>
        <select
          name="assetId"
          value={formData.assetId}
          onChange={handleChange}
          required
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Choose an asset...</option>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.assetNumber} - {asset.name}
            </option>
          ))}
        </select>
      </div>

      {/* Selected Asset Info */}
      {selectedAsset && (
        <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg flex items-start space-x-4">
          <div className="h-12 w-12 bg-white dark:bg-gray-600 rounded-lg flex items-center justify-center">
            <Package className="h-6 w-6 text-gray-400 dark:text-gray-500" />
          </div>
          <div>
            <p className="font-medium text-gray-900 dark:text-white">{selectedAsset.name}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {selectedAsset.manufacturer} {selectedAsset.model}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 font-mono mt-1">
              {selectedAsset.assetNumber}
              {selectedAsset.serialNumber && ` | S/N: ${selectedAsset.serialNumber}`}
            </p>
          </div>
        </div>
      )}

      {/* Maintenance Type Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Maintenance Type *
        </label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {MAINTENANCE_TYPES.map(({ value, label, description, Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => handleTypeSelect(value)}
              className={`p-3 border rounded-lg flex flex-col items-center space-y-1 transition-colors text-center ${
                formData.maintenanceType === value
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-sm font-medium">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Scheduled Date */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Scheduled Date *
          </label>
          <input
            type="date"
            name="scheduledDate"
            value={formData.scheduledDate}
            onChange={handleChange}
            required
            min={new Date().toISOString().split('T')[0]}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Due Date
          </label>
          <input
            type="date"
            name="dueDate"
            value={formData.dueDate}
            onChange={handleChange}
            min={formData.scheduledDate || new Date().toISOString().split('T')[0]}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Provider Information */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Service Provider</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Provider Name
            </label>
            <input
              type="text"
              name="providerName"
              value={formData.providerName}
              onChange={handleChange}
              placeholder="e.g., EXFO Service Center"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Provider Contact
            </label>
            <input
              type="text"
              name="providerContact"
              value={formData.providerContact}
              onChange={handleChange}
              placeholder="Phone or email"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Description
        </label>
        <textarea
          name="description"
          value={formData.description}
          onChange={handleChange}
          rows={3}
          placeholder="Describe the maintenance work to be performed..."
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Notes */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Notes
        </label>
        <textarea
          name="notes"
          value={formData.notes}
          onChange={handleChange}
          rows={2}
          placeholder="Any additional notes..."
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
          disabled={loading || !formData.assetId || !formData.scheduledDate}
          className="inline-flex items-center px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Scheduling...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Schedule Maintenance
            </>
          )}
        </button>
      </div>
    </form>
  );
}
