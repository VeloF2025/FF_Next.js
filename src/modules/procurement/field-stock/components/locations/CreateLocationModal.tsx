/**
 * CreateLocationModal — Add a new stock location
 */

'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, MapPin } from 'lucide-react';
import { log } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import type { CreateLocationInput, LocationType } from '../../types';

interface CreateLocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (input: CreateLocationInput) => Promise<void>;
}

const LOCATION_TYPES: { value: LocationType; label: string }[] = [
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'site_store', label: 'Site Store' },
  { value: 'transit', label: 'In Transit' },
  { value: 'technician', label: 'Technician Van' },
  { value: 'customer', label: 'Customer' },
  { value: 'scrap', label: 'Scrap' },
  { value: 'adjustment', label: 'Adjustment' },
];

export function CreateLocationModal({ isOpen, onClose, onCreated }: CreateLocationModalProps) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [locationType, setLocationType] = useState<LocationType>('warehouse');
  const [address, setAddress] = useState('');
  const [assignedToName, setAssignedToName] = useState('');
  const [assignedToPhone, setAssignedToPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setName('');
    setCode('');
    setLocationType('warehouse');
    setAddress('');
    setAssignedToName('');
    setAssignedToPhone('');
    setError(null);
  };

  // Auto-generate code from name
  const handleNameChange = (val: string) => {
    setName(val);
    if (!code || code === generateCode(name)) {
      setCode(generateCode(val));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !code.trim()) return;

    setError(null);
    setIsSubmitting(true);

    try {
      await onCreated({
        name: name.trim(),
        code: code.trim().toUpperCase(),
        locationType,
        address: address.trim() || undefined,
        assignedToName: assignedToName.trim() || undefined,
        assignedToPhone: assignedToPhone.trim() || undefined,
      });
      resetForm();
      onClose();
    } catch (err) {
      log.error('Failed to create location', { error: err }, 'CreateLocationModal');
      setError(err instanceof Error ? err.message : 'Failed to create location');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const inputCls = 'w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50';
  const labelCls = 'block text-sm font-medium text-[var(--ff-text-secondary)] mb-1';

  return createPortal(
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[10000]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-blue-400" />
            <h2 className="text-base font-semibold text-[var(--ff-text-primary)]">Add Location</h2>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        </div>

        {error && (
          <p className="mb-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className={labelCls}>Location Name <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              required
              maxLength={200}
              placeholder="e.g. Main Warehouse, John's Van"
              className={inputCls}
            />
          </div>

          {/* Code + Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Code <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                required
                maxLength={20}
                placeholder="e.g. WH-MAIN"
                className={inputCls + ' uppercase'}
              />
            </div>
            <div>
              <label className={labelCls}>Type <span className="text-red-400">*</span></label>
              <select
                value={locationType}
                onChange={(e) => setLocationType(e.target.value as LocationType)}
                className={inputCls}
              >
                {LOCATION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Address */}
          <div>
            <label className={labelCls}>Address <span className="text-xs text-[var(--ff-text-tertiary)]">(optional)</span></label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={300}
              placeholder="Physical address"
              className={inputCls}
            />
          </div>

          {/* Assigned to (for technician/site_store types) */}
          {(locationType === 'technician' || locationType === 'site_store') && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Assigned To</label>
                <input
                  type="text"
                  value={assignedToName}
                  onChange={(e) => setAssignedToName(e.target.value)}
                  maxLength={200}
                  placeholder="Person name"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Phone</label>
                <input
                  type="text"
                  value={assignedToPhone}
                  onChange={(e) => setAssignedToPhone(e.target.value)}
                  maxLength={20}
                  placeholder="Phone number"
                  className={inputCls}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || !code.trim() || isSubmitting}
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
              Add Location
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

/** Generate a code from a name: "Main Warehouse" → "MAIN-WH" */
function generateCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].substring(0, 8).toUpperCase();
  return words.map(w => w.substring(0, 4)).join('-').substring(0, 15).toUpperCase();
}

export default CreateLocationModal;
