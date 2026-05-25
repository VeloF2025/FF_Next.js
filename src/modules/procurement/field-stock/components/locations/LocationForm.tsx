'use client';

import { useMemo } from 'react';
import { useLocations } from '../../hooks';
import type { CreateLocationInput, LocationType, StockLocation } from '../../types';

export interface LocationFormValue {
  name: string;
  code: string;
  locationType: LocationType;
  address: string;
  lat: string;            // kept as string for controlled inputs; parsed on submit
  lng: string;
  parentId: string;       // '' = no parent
  assignedToName: string;
  assignedToPhone: string;
}

interface LocationFormProps {
  value: LocationFormValue;
  onChange: (next: LocationFormValue) => void;
  /** When editing, code + type are immutable (they anchor movements/quants). */
  mode: 'create' | 'edit';
  /** Exclude self from parent options when editing. */
  selfId?: string;
}

const LOCATION_TYPES: { value: LocationType; label: string }[] = [
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'site_store', label: 'Site Store' },
  { value: 'transit', label: 'In Transit' },
  { value: 'customer', label: 'Customer' },
];

const inputCls =
  'w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50';
const labelCls = 'block text-sm font-medium text-[var(--ff-text-secondary)] mb-1';

export function generateCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0]!.substring(0, 8).toUpperCase();
  return words.map((w) => w.substring(0, 4)).join('-').substring(0, 15).toUpperCase();
}

export function LocationForm({ value, onChange, mode, selfId }: LocationFormProps) {
  // Parent options: warehouses + site stores (a hub or another store can be a parent).
  const { locations } = useLocations({
    filters: { isActive: true },
    autoFetch: true,
  });

  const parentOptions = useMemo(
    () =>
      locations.filter(
        (l: StockLocation) =>
          (l.locationType === 'warehouse' || l.locationType === 'site_store') &&
          l.id !== selfId,
      ),
    [locations, selfId],
  );

  const set = (patch: Partial<LocationFormValue>) => onChange({ ...value, ...patch });

  const handleName = (name: string) => {
    if (mode === 'create' && (!value.code || value.code === generateCode(value.name))) {
      set({ name, code: generateCode(name) });
    } else {
      set({ name });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Location Name <span className="text-red-400">*</span></label>
        <input
          type="text"
          value={value.name}
          onChange={(e) => handleName(e.target.value)}
          required
          maxLength={200}
          placeholder="e.g. Garstfontein DC, Lawley Site Store"
          className={inputCls}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Code <span className="text-red-400">*</span></label>
          <input
            type="text"
            value={value.code}
            onChange={(e) => set({ code: e.target.value.toUpperCase() })}
            required
            maxLength={20}
            disabled={mode === 'edit'}
            placeholder="e.g. DC-GARST"
            className={inputCls + (mode === 'edit' ? ' opacity-60 cursor-not-allowed' : ' uppercase')}
          />
        </div>
        <div>
          <label className={labelCls}>Type <span className="text-red-400">*</span></label>
          <select
            value={value.locationType}
            onChange={(e) => set({ locationType: e.target.value as LocationType })}
            disabled={mode === 'edit'}
            className={inputCls + (mode === 'edit' ? ' opacity-60 cursor-not-allowed' : '')}
          >
            {LOCATION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelCls}>Parent location <span className="text-xs text-[var(--ff-text-tertiary)]">(optional — e.g. the DC a site store rolls up to)</span></label>
        <select
          value={value.parentId}
          onChange={(e) => set({ parentId: e.target.value })}
          className={inputCls}
        >
          <option value="">— none (top-level hub) —</option>
          {parentOptions.map((l) => (
            <option key={l.id} value={l.id}>{l.name} ({l.code})</option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls}>Address <span className="text-xs text-[var(--ff-text-tertiary)]">(optional)</span></label>
        <input
          type="text"
          value={value.address}
          onChange={(e) => set({ address: e.target.value })}
          maxLength={300}
          placeholder="Physical address"
          className={inputCls}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Latitude <span className="text-xs text-[var(--ff-text-tertiary)]">(optional)</span></label>
          <input
            type="number" step="any" inputMode="decimal"
            value={value.lat}
            onChange={(e) => set({ lat: e.target.value })}
            placeholder="-25.7896"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Longitude <span className="text-xs text-[var(--ff-text-tertiary)]">(optional)</span></label>
          <input
            type="number" step="any" inputMode="decimal"
            value={value.lng}
            onChange={(e) => set({ lng: e.target.value })}
            placeholder="28.2768"
            className={inputCls}
          />
        </div>
      </div>

      {value.locationType === 'site_store' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Assigned To</label>
            <input
              type="text"
              value={value.assignedToName}
              onChange={(e) => set({ assignedToName: e.target.value })}
              maxLength={200}
              placeholder="Person name"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Phone</label>
            <input
              type="text"
              value={value.assignedToPhone}
              onChange={(e) => set({ assignedToPhone: e.target.value })}
              maxLength={20}
              placeholder="Phone number"
              className={inputCls}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Build a CreateLocationInput from form state (coords parsed, blanks dropped). */
export function toCreateInput(v: LocationFormValue): CreateLocationInput {
  const lat = parseFloat(v.lat);
  const lng = parseFloat(v.lng);
  const coordinates =
    Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
  return {
    name: v.name.trim(),
    code: v.code.trim().toUpperCase(),
    locationType: v.locationType,
    address: v.address.trim() || undefined,
    coordinates,
    parentId: v.parentId || undefined,
    assignedToName: v.assignedToName.trim() || undefined,
    assignedToPhone: v.assignedToPhone.trim() || undefined,
  };
}

export const EMPTY_LOCATION_FORM: LocationFormValue = {
  name: '', code: '', locationType: 'warehouse', address: '',
  lat: '', lng: '', parentId: '', assignedToName: '', assignedToPhone: '',
};
