'use client';

import { useMemo } from 'react';
import { useProjects } from '@/hooks/useProjects';
import { useLocations } from '../../hooks';
import type { LocationType, StockLocation } from '../../types';
import { generateCode, type LocationFormValue } from './locationForm.utils';

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

export function LocationForm({ value, onChange, mode, selfId }: LocationFormProps) {
  // Parent options: warehouses + site stores (a hub or another store can be a parent).
  const { locations } = useLocations({
    filters: { isActive: true },
    autoFetch: true,
  });

  // Only hub/store types can be parents; vans, customers, scrap/adjust are leaf nodes.
  // Virtual locations (e.g. Faulty Equipment Bin) are never valid parents.
  const parentOptions = useMemo(
    () =>
      locations.filter(
        (l: StockLocation) =>
          (l.locationType === 'warehouse' || l.locationType === 'site_store') &&
          !l.isVirtual &&
          l.id !== selfId,
      ),
    [locations, selfId],
  );

  // Project association (optional): which project this location serves.
  const { data: projects } = useProjects();
  const projectOptions = useMemo(
    () =>
      (projects ?? [])
        .map((p) => ({ id: p.id, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [projects],
  );

  const set = (patch: Partial<LocationFormValue>) => onChange({ ...value, ...patch });

  const handleName = (name: string) => {
    if (mode === 'create' && (!value.code || value.code === generateCode(value.name))) {
      set({ name, code: generateCode(name) });
    } else {
      set({ name });
    }
  };

  // In edit mode the (disabled) select must still show a hidden persisted type
  // (e.g. technician) that isn't in the creatable list.
  const typeOptions = LOCATION_TYPES.some((t) => t.value === value.locationType)
    ? LOCATION_TYPES
    : [...LOCATION_TYPES, { value: value.locationType, label: value.locationType }];

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
            {typeOptions.map((t) => (
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
        <label className={labelCls}>Project <span className="text-xs text-[var(--ff-text-tertiary)]">(optional — the project this location serves)</span></label>
        <select
          value={value.projectId}
          onChange={(e) => set({ projectId: e.target.value })}
          className={inputCls}
        >
          <option value="">— none —</option>
          {projectOptions.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
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
            min={-90} max={90}
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
            min={-180} max={180}
            value={value.lng}
            onChange={(e) => set({ lng: e.target.value })}
            placeholder="28.2768"
            className={inputCls}
          />
        </div>
      </div>

      {(value.locationType === 'site_store' || value.locationType === 'technician') && (
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
