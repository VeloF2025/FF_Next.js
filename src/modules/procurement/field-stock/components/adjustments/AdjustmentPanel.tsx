/**
 * AdjustmentPanel
 * List adjustment history + create new adjustments
 */

import { useState, useEffect } from 'react';
import {
  Settings,
  Plus,
  Search,
  ArrowDown,
  ArrowUp,
  Calendar,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useAdjustments, useLocations } from '../../hooks';
import { CreateAdjustmentForm } from './CreateAdjustmentForm';
import { formatDisplayDate } from '@/utils/dateFormat';

export function AdjustmentPanel() {
  const { adjustments, loading, error, reasons, refresh, createAdjustment, fetchReasons } =
    useAdjustments({ autoFetch: true });
  const { locations } = useLocations({ autoFetch: true });

  const [showCreate, setShowCreate] = useState(false);
  const [filterLocation, setFilterLocation] = useState('');
  const [filterReason, setFilterReason] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  useEffect(() => {
    fetchReasons();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApplyFilters = () => {
    refresh({
      location_id: filterLocation || undefined,
      reason_code: filterReason || undefined,
      date_from: filterDateFrom || undefined,
      date_to: filterDateTo || undefined,
    });
  };

  const handleCreate = async (input: {
    stock_item_id: string;
    location_id: string;
    adjustment_type: 'increase' | 'decrease';
    quantity: number;
    reason_code: string;
    notes?: string;
  }) => {
    await createAdjustment(input);
    refresh();
  };

  const physicalLocations = locations.filter((l) =>
    ['warehouse', 'technician', 'site'].includes(l.locationType)
  );

  // Parse reason from notes field (format: [REASON_CODE] optional notes)
  const parseReason = (notes?: string): string => {
    if (!notes) return '-';
    const match = notes.match(/^\[([A-Z_]+)\]/);
    return match ? match[1] : '-';
  };

  // Determine if adjustment is increase or decrease based on location names
  const isIncrease = (adj: typeof adjustments[0]): boolean => {
    return adj.from_location_name?.includes('Adjustment') ?? false;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-[var(--ff-text-tertiary)]" />
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Stock Adjustments</h2>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Adjustment
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 p-4 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
        <div>
          <label className="block text-xs text-[var(--ff-text-tertiary)] mb-1">Location</label>
          <select
            value={filterLocation}
            onChange={(e) => setFilterLocation(e.target.value)}
            className="px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)]"
          >
            <option value="">All Locations</option>
            {physicalLocations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-[var(--ff-text-tertiary)] mb-1">Reason</label>
          <select
            value={filterReason}
            onChange={(e) => setFilterReason(e.target.value)}
            className="px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)]"
          >
            <option value="">All Reasons</option>
            {reasons.map((r) => (
              <option key={r.id} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-[var(--ff-text-tertiary)] mb-1">From</label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              className="pl-10 pr-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)]"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-[var(--ff-text-tertiary)] mb-1">To</label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              className="pl-10 pr-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)]"
            />
          </div>
        </div>

        <button
          onClick={handleApplyFilters}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm transition-colors"
        >
          <Search className="h-4 w-4" />
          Filter
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Adjustment History Table */}
      {loading ? (
        <LoadingSpinner className="h-48" size="lg" label="Loading adjustments..." />
      ) : adjustments.length === 0 ? (
        <div className="text-center py-12 text-[var(--ff-text-secondary)]">
          <Settings className="h-12 w-12 mx-auto mb-3 text-[var(--ff-text-tertiary)]" />
          <p>No adjustments found</p>
          <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
            Create an adjustment to correct stock quantities
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Reference</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Item</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Location</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Type</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Qty</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Reason</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ff-border-light)]">
              {adjustments.map((adj) => {
                const increase = isIncrease(adj);
                const locationName = increase ? adj.to_location_name : adj.from_location_name;
                return (
                  <tr key={adj.id} className="hover:bg-[var(--ff-bg-secondary)]">
                    <td className="px-4 py-3 text-[var(--ff-text-primary)]">
                      {formatDisplayDate(adj.performed_at)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--ff-text-secondary)]">
                      {adj.reference}
                    </td>
                    <td className="px-4 py-3 text-[var(--ff-text-primary)]">
                      <div>
                        <span className="font-medium">{adj.item_name || '-'}</span>
                        {adj.item_code && (
                          <span className="ml-1 text-xs text-[var(--ff-text-tertiary)]">({adj.item_code})</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--ff-text-primary)]">
                      {locationName || '-'}
                    </td>
                    <td className="px-4 py-3">
                      {increase ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400">
                          <ArrowUp className="h-3 w-3" /> Increase
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400">
                          <ArrowDown className="h-3 w-3" /> Decrease
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[var(--ff-text-primary)]">
                      {adj.quantity}
                    </td>
                    <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                      {parseReason(adj.notes)}
                    </td>
                    <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                      {adj.performed_by || '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Modal */}
      <CreateAdjustmentForm
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={handleCreate}
        reasons={reasons}
      />
    </div>
  );
}
