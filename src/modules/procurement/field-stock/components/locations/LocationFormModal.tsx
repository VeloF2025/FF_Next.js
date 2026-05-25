'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, MapPin } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import type { CreateLocationInput, StockLocation, UpdateLocationInput } from '../../types';
import { LocationForm } from './LocationForm';
import { EMPTY_LOCATION_FORM, toCreateInput, type LocationFormValue } from './locationForm.utils';

interface LocationFormModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  /** Required in edit mode. */
  location?: StockLocation | null;
  onClose: () => void;
  onCreate: (input: CreateLocationInput) => Promise<void>;
  onUpdate: (id: string, input: UpdateLocationInput) => Promise<void>;
}

function toFormValue(loc: StockLocation): LocationFormValue {
  return {
    name: loc.name ?? '',
    code: loc.code ?? '',
    locationType: loc.locationType,
    address: loc.address ?? '',
    lat: loc.coordinates ? String(loc.coordinates.lat) : '',
    lng: loc.coordinates ? String(loc.coordinates.lng) : '',
    parentId: loc.parentId ?? '',
    assignedToName: loc.assignedToName ?? '',
    assignedToPhone: loc.assignedToPhone ?? '',
  };
}

export function LocationFormModal({
  isOpen, mode, location, onClose, onCreate, onUpdate,
}: LocationFormModalProps) {
  const [value, setValue] = useState<LocationFormValue>(EMPTY_LOCATION_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setValue(mode === 'edit' && location ? toFormValue(location) : EMPTY_LOCATION_FORM);
  }, [isOpen, mode, location]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.name.trim() || !value.code.trim()) return;
    setError(null);
    setIsSubmitting(true);
    try {
      if (mode === 'edit' && location) {
        const lat = parseFloat(value.lat);
        const lng = parseFloat(value.lng);
        const update: UpdateLocationInput = {
          parentId: value.parentId,   // '' clears the parent, a uuid sets it
          name: value.name.trim(),
          address: value.address.trim() || undefined,
          coordinates: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined,
          assignedToName: value.assignedToName.trim() || undefined,
          assignedToPhone: value.assignedToPhone.trim() || undefined,
        };
        await onUpdate(location.id, update);
      } else {
        await onCreate(toCreateInput(value));
      }
      onClose();
    } catch (err) {
      log.error('Failed to save location', { error: err }, 'LocationFormModal');
      setError(err instanceof Error ? err.message : 'Failed to save location');
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[10000]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-blue-400" />
            <h2 className="text-base font-semibold text-[var(--ff-text-primary)]">
              {mode === 'edit' ? 'Edit Location' : 'Add Location'}
            </h2>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        </div>

        {error && (
          <p className="mb-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <LocationForm value={value} onChange={setValue} mode={mode} selfId={location?.id} />
          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!value.name.trim() || !value.code.trim() || isSubmitting}>
              {isSubmitting ? <InlineSpinner size="sm" /> : <MapPin className="h-4 w-4" />}
              {mode === 'edit' ? 'Save Changes' : 'Add Location'}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

export default LocationFormModal;
