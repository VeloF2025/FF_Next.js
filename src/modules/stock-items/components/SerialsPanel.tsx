/**
 * SerialsPanel - Shows all serials for a stock item with checkout/checkin actions
 * Only rendered for items in checkout-eligible categories (tools, assets, ppe)
 */

import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, ArrowRightLeft, ArrowDownLeft, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CheckoutModal } from './CheckoutModal';
import { CheckinModal } from './CheckinModal';
import { log } from '@/lib/logger';

interface Serial {
  id: string;
  stock_item_id: string;
  serial_number: string;
  status: string;
  current_checkout_id: string | null;
  checked_out_by_name?: string;
  project_name?: string;
  job_site_name?: string;
  expected_return_date?: string;
  checked_out_at?: string;
}

interface SerialsPanelProps {
  stockItemId: string;
  stockItemName: string;
  category: string;
}

const CHECKOUT_ELIGIBLE = ['tools', 'assets', 'ppe'];

export function SerialsPanel({ stockItemId, stockItemName, category }: SerialsPanelProps) {
  const [serials, setSerials] = useState<Serial[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add serial form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSerial, setNewSerial] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  // Modals
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkinCheckout, setCheckinCheckout] = useState<Serial | null>(null);

  const isEligible = CHECKOUT_ELIGIBLE.includes(category?.toLowerCase());

  const fetchSerials = useCallback(async () => {
    if (!stockItemId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/stock/serials?stockItemId=${stockItemId}`);
      const data = await res.json();
      if (res.ok) {
        setSerials(data.data || []);
      } else {
        setError(data.error || 'Failed to load serials');
      }
    } catch (err) {
      log.error('Failed to fetch serials', { error: err }, 'SerialsPanel');
      setError('Failed to load serials');
    } finally {
      setIsLoading(false);
    }
  }, [stockItemId]);

  useEffect(() => {
    if (isEligible) fetchSerials();
  }, [isEligible, fetchSerials]);

  const handleAddSerial = async () => {
    if (!newSerial.trim()) return;
    setIsAdding(true);
    try {
      const res = await fetch('/api/stock/serials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockItemId, serialNumber: newSerial.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add serial');
      setNewSerial('');
      setShowAddForm(false);
      fetchSerials();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add serial');
    } finally {
      setIsAdding(false);
    }
  };

  if (!isEligible) return null;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-[var(--ff-text-primary)]">
          Units / Checkout
        </h4>
        <Button
          type="button"
          size="sm"
          onClick={() => setShowAddForm(true)}
        >
          <Plus className="h-3 w-3" /> Add Serial
        </Button>
      </div>

      {/* Add serial inline form */}
      {showAddForm && (
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={newSerial}
            onChange={(e) => setNewSerial(e.target.value)}
            placeholder="Enter serial number"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddSerial(); } }}
            className="flex-1 px-3 py-1.5 text-sm border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded text-[var(--ff-text-primary)] focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <Button
            type="button"
            size="sm"
            onClick={handleAddSerial}
            disabled={isAdding || !newSerial.trim()}
          >
            {isAdding ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => { setShowAddForm(false); setNewSerial(''); }}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-2 bg-red-500/10 border border-red-500/30 rounded flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5 text-red-400" />
          <p className="text-xs text-red-400">{error}</p>
          <Button variant="ghost" size="sm" onClick={() => setError(null)} className="ml-auto">
            Dismiss
          </Button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--ff-text-tertiary)]" />
        </div>
      )}

      {/* Serials table */}
      {!isLoading && serials.length === 0 && (
        <div className="text-center py-6 text-[var(--ff-text-tertiary)]">
          <p className="text-sm">No serials registered yet</p>
          <p className="text-xs mt-1">Add serial numbers to enable checkout tracking</p>
        </div>
      )}

      {!isLoading && serials.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--ff-border-light)]">
                <th className="text-left py-2 px-2 text-xs font-medium text-[var(--ff-text-tertiary)]">Serial</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-[var(--ff-text-tertiary)]">Status</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-[var(--ff-text-tertiary)]">Checked Out To</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-[var(--ff-text-tertiary)]">Location</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-[var(--ff-text-tertiary)]">Due</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-[var(--ff-text-tertiary)]">Action</th>
              </tr>
            </thead>
            <tbody>
              {serials.map(serial => {
                const isOverdue = serial.status === 'checked_out' && serial.expected_return_date &&
                  new Date(serial.expected_return_date) < new Date();
                const location = serial.project_name || serial.job_site_name || '-';

                return (
                  <tr key={serial.id} className="border-b border-[var(--ff-border-light)]/50 hover:bg-[var(--ff-bg-hover)]">
                    <td className="py-2 px-2 font-mono text-xs text-[var(--ff-text-primary)]">
                      {serial.serial_number}
                    </td>
                    <td className="py-2 px-2">
                      {serial.status === 'available' && (
                        <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-green-500/20 text-green-400">
                          Available
                        </span>
                      )}
                      {serial.status === 'checked_out' && (
                        <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${
                          isOverdue ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                        }`}>
                          {isOverdue ? 'Overdue' : 'Checked Out'}
                        </span>
                      )}
                      {serial.status === 'retired' && (
                        <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-gray-500/20 text-gray-400">
                          Retired
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-xs text-[var(--ff-text-secondary)]">
                      {serial.checked_out_by_name || '-'}
                    </td>
                    <td className="py-2 px-2 text-xs text-[var(--ff-text-secondary)]">
                      {location}
                    </td>
                    <td className="py-2 px-2 text-xs">
                      {serial.expected_return_date ? (
                        <span className={isOverdue ? 'text-red-400 font-medium' : 'text-[var(--ff-text-secondary)]'}>
                          {new Date(serial.expected_return_date).toLocaleDateString()}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {serial.status === 'available' && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowCheckout(true)}
                        >
                          <ArrowRightLeft className="h-3 w-3" /> Check Out
                        </Button>
                      )}
                      {serial.status === 'checked_out' && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setCheckinCheckout(serial)}
                        >
                          <ArrowDownLeft className="h-3 w-3" /> Check In
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Checkout Modal */}
      {showCheckout && (
        <CheckoutModal
          stockItemId={stockItemId}
          stockItemName={stockItemName}
          serials={serials}
          onClose={() => setShowCheckout(false)}
          onSuccess={() => {
            setShowCheckout(false);
            fetchSerials();
          }}
        />
      )}

      {/* Checkin Modal */}
      {checkinCheckout && (
        <CheckinModal
          checkout={{
            id: checkinCheckout.current_checkout_id!,
            serial_number: checkinCheckout.serial_number,
            checked_out_by_name: checkinCheckout.checked_out_by_name || '',
            project_name: checkinCheckout.project_name,
            job_site_name: checkinCheckout.job_site_name,
            expected_return_date: checkinCheckout.expected_return_date || '',
            checked_out_at: checkinCheckout.checked_out_at || '',
          }}
          itemName={stockItemName}
          onClose={() => setCheckinCheckout(null)}
          onSuccess={() => {
            setCheckinCheckout(null);
            fetchSerials();
          }}
        />
      )}
    </div>
  );
}
