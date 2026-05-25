# Location Management v2 (Sprint B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a real location-management surface — edit/soft-delete with a stock guard, richer setup fields (coordinates + parent hierarchy), a real Garstfontein DC, and a setup list that hides system/virtual locations.

**Architecture:** The API (`GET/POST/PUT/DELETE`) and the `useLocations` hook already do full CRUD end-to-end. This sprint adds (1) a server-side **delete guard** that blocks soft-deleting a location holding stock, (2) a shared **LocationForm** with the DB-supported `coordinates` and `parentId` fields, (3) a **LocationFormModal** that does both create and edit, wired to an edit affordance in `LocationList`, (4) **filtering** of system/virtual location types out of the admin list, and (5) a **migration** creating the Garstfontein DC hub. Hierarchy is expressed via the new parent picker (a tree-render UI is deliberately deferred — YAGNI for B).

**Tech Stack:** Next.js Pages Router, React, TypeScript, `pg.Pool` (`./db` query helper) + Neon shim (`@/lib/db-neon`), Vitest, Tailwind dark theme tokens.

**Scope note:** `project_id` linkage on a location is deferred to Sprint C/D, where project-scoped custody makes it meaningful. B adds `coordinates` + `parentId` only. No mass re-parenting of the existing 13 site warehouses — admins assign parents via the new edit form.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/modules/procurement/field-stock/services/locationService.ts` | Add `checkLocationDeletable` pure helper; enforce it in `deleteLocation` | Modify |
| `src/modules/procurement/field-stock/__tests__/locationService.test.ts` | Unit-test the pure deletion guard | Create |
| `pages/api/procurement/field-stock/locations/[locationId].ts` | Map `LOCATION_NOT_EMPTY` → 400 instead of 500 | Modify |
| `src/modules/procurement/field-stock/components/locations/LocationForm.tsx` | Shared field set + state for create/edit (name, code, type, address, coordinates, parent, assignee) | Create |
| `src/modules/procurement/field-stock/components/locations/LocationFormModal.tsx` | Modal wrapping `LocationForm`; create OR edit mode | Create |
| `src/modules/procurement/field-stock/components/locations/CreateLocationModal.tsx` | Delete (superseded by `LocationFormModal`) | Delete |
| `src/modules/procurement/field-stock/components/locations/LocationList.tsx` | Edit button per row; hide system/virtual types | Modify |
| `src/modules/procurement/field-stock/components/locations/index.ts` (barrel, if present) | Export new components | Modify |
| `pages/procurement/field-stock/index.tsx` | Mount `LocationFormModal` for create+edit | Modify |
| `scripts/migrations/sql/<version>_create_garstfontein_dc.sql` | Idempotent insert of the Garstfontein DC hub | Create |

---

## Task 1: Delete guard — block deleting a location that still holds stock

**Files:**
- Modify: `src/modules/procurement/field-stock/services/locationService.ts`
- Modify: `pages/api/procurement/field-stock/locations/[locationId].ts`
- Test: `src/modules/procurement/field-stock/__tests__/locationService.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/procurement/field-stock/__tests__/locationService.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { checkLocationDeletable } from '../services/locationService';

describe('checkLocationDeletable', () => {
  it('allows deletion when no stock is on hand', () => {
    expect(checkLocationDeletable(0)).toEqual({ deletable: true });
  });

  it('blocks deletion when stock is on hand and explains why', () => {
    const result = checkLocationDeletable(5);
    expect(result.deletable).toBe(false);
    expect(result.reason).toMatch(/5/);
    expect(result.reason).toMatch(/stock/i);
  });

  it('treats negative/NaN on-hand as blocked (defensive)', () => {
    expect(checkLocationDeletable(Number.NaN).deletable).toBe(false);
    expect(checkLocationDeletable(-1).deletable).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/hein/Workspace/FF_Next.js-wt/stock-locations-custody && npx vitest run src/modules/procurement/field-stock/__tests__/locationService.test.ts`
Expected: FAIL — `checkLocationDeletable` is not exported.

- [ ] **Step 3: Add the pure helper to `locationService.ts`**

Add near the top of the file, after the imports/`const sql` line:

```typescript
export interface LocationDeletionCheck {
  deletable: boolean;
  reason?: string;
}

/**
 * Pure rule: a location may only be soft-deleted when it holds no stock.
 * Defensive: any non-positive-finite on-hand other than exactly 0 is blocked.
 */
export function checkLocationDeletable(stockOnHand: number): LocationDeletionCheck {
  if (!Number.isFinite(stockOnHand) || stockOnHand !== 0) {
    if (stockOnHand > 0) {
      return {
        deletable: false,
        reason: `Cannot delete: ${stockOnHand} unit(s) of stock still held at this location. Move or consume the stock first.`,
      };
    }
    // NaN or negative → unknown state, refuse rather than risk losing a record with stock.
    return {
      deletable: false,
      reason: 'Cannot delete: stock level for this location could not be confirmed.',
    };
  }
  return { deletable: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/hein/Workspace/FF_Next.js-wt/stock-locations-custody && npx vitest run src/modules/procurement/field-stock/__tests__/locationService.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Enforce the guard in `deleteLocation`**

Replace the existing `deleteLocation` function body (currently a bare soft-delete) with:

```typescript
export async function deleteLocation(id: string): Promise<void> {
  try {
    const onHand = await getLocationStockCount(id);
    const check = checkLocationDeletable(onHand);
    if (!check.deletable) {
      const err = new Error(check.reason) as Error & { code?: string };
      err.code = 'LOCATION_NOT_EMPTY';
      throw err;
    }
    await sql`
      UPDATE stock_locations
      SET is_active = false, updated_at = NOW()
      WHERE id = ${id}
    `;
    log.info(`Deleted location: ${id}`, undefined, 'locationService');
  } catch (error) {
    log.error('Failed to delete location', { error }, 'locationService');
    throw error;
  }
}
```

Note: `getLocationStockCount` already exists in this file (sums `stock_quants.quantity` for the location).

- [ ] **Step 6: Map the guard error to a 400 in the API route**

In `pages/api/procurement/field-stock/locations/[locationId].ts`, replace the `DELETE` branch:

```typescript
    if (req.method === 'DELETE') {
      try {
        await deleteLocation(locationId);
        return apiResponse.success(res, { message: 'Location deleted successfully' });
      } catch (err) {
        if ((err as { code?: string }).code === 'LOCATION_NOT_EMPTY') {
          return apiResponse.validationError(res, { stock: (err as Error).message });
        }
        throw err;
      }
    }
```

- [ ] **Step 7: Type-check**

Run: `cd /home/hein/Workspace/FF_Next.js-wt/stock-locations-custody && npx tsc --noEmit`
Expected: no new errors in the two touched files.

- [ ] **Step 8: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-wt/stock-locations-custody && git add src/modules/procurement/field-stock/services/locationService.ts src/modules/procurement/field-stock/__tests__/locationService.test.ts "pages/api/procurement/field-stock/locations/[locationId].ts" && git commit -m "feat(field-stock): block deleting a location that still holds stock"
```

---

## Task 2: Shared `LocationForm` with coordinates + parent picker

**Files:**
- Create: `src/modules/procurement/field-stock/components/locations/LocationForm.tsx`

This extracts all fields + local state out of the old create modal (which was 225 lines — over the 200-line component limit) so both create and edit modals stay thin. Adds `coordinates` (lat/lng) and `parentId` (parent location picker). Parent options are warehouses fetched via the existing `useLocations` hook.

- [ ] **Step 1: Create the component**

```tsx
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
```

Note: `LocationType` here intentionally omits the system/virtual types (`technician`, `scrap`, `adjustment`) — those are not user-creatable. The exported `generateCode`, `toCreateInput`, and `EMPTY_LOCATION_FORM` keep the modal thin.

- [ ] **Step 2: Type-check**

Run: `cd /home/hein/Workspace/FF_Next.js-wt/stock-locations-custody && npx tsc --noEmit`
Expected: no errors. (`coordinates` and `parentId` already exist on `CreateLocationInput`.)

- [ ] **Step 3: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-wt/stock-locations-custody && git add src/modules/procurement/field-stock/components/locations/LocationForm.tsx && git commit -m "feat(field-stock): shared LocationForm with coordinates + parent picker"
```

---

## Task 3: `LocationFormModal` (create + edit) and wire it in

**Files:**
- Create: `src/modules/procurement/field-stock/components/locations/LocationFormModal.tsx`
- Modify: `src/modules/procurement/field-stock/components/locations/LocationList.tsx`
- Modify: `pages/procurement/field-stock/index.tsx`
- Delete: `src/modules/procurement/field-stock/components/locations/CreateLocationModal.tsx`

- [ ] **Step 1: Create `LocationFormModal.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, MapPin } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import type { CreateLocationInput, StockLocation, UpdateLocationInput } from '../../types';
import {
  LocationForm, EMPTY_LOCATION_FORM, toCreateInput, type LocationFormValue,
} from './LocationForm';

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
```

- [ ] **Step 2: Add an Edit affordance to `LocationList.tsx`**

Add an optional `onEditLocation` prop and an edit button per row. In the props interface add:

```tsx
  onEditLocation?: (location: StockLocation) => void;
```

Add `Pencil` to the lucide import line:

```tsx
import { MapPin, Plus, Search, Filter, Building2, Truck, User, Package, Pencil } from 'lucide-react';
```

Replace the row `<button …>` element with a `div` row that keeps select-on-click but adds an explicit edit button (a `<button>` inside a `<button>` is invalid HTML):

```tsx
            <div
              key={location.id}
              className={`flex w-full items-center justify-between p-4 transition-colors hover:bg-accent ${
                selectedLocationId === location.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
              }`}
            >
              <button
                onClick={() => onSelectLocation?.(location)}
                className="flex flex-1 items-center gap-4 text-left"
              >
                <div className={`rounded-lg p-2 ${locationTypeColors[location.locationType]}`}>
                  {locationTypeIcons[location.locationType]}
                </div>
                <div>
                  <p className="font-medium text-foreground">{location.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {location.code}
                    {location.assignedToName && ` • ${location.assignedToName}`}
                  </p>
                </div>
              </button>
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${locationTypeColors[location.locationType]}`}>
                  {locationTypeLabels[location.locationType]}
                </span>
                {onEditLocation && (
                  <button
                    type="button"
                    onClick={() => onEditLocation(location)}
                    className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    aria-label={`Edit ${location.name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
```

- [ ] **Step 3: Wire the modal in `pages/procurement/field-stock/index.tsx`**

Replace the `CreateLocationModal` import with `LocationFormModal`, and replace the locations-tab render block (around the current lines 114–122) with create+edit state:

```tsx
import { LocationFormModal } from '@/modules/procurement/field-stock/components/locations/LocationFormModal';
```

```tsx
  const { createLocation, updateLocation } = useLocations({ autoFetch: false });
  const [showCreate, setShowCreate] = useState(false);
  const [editLocation, setEditLocation] = useState<StockLocation | null>(null);

  return (
    <>
      <LocationList
        onCreateClick={() => setShowCreate(true)}
        onEditLocation={(loc) => setEditLocation(loc)}
      />
      <LocationFormModal
        isOpen={showCreate}
        mode="create"
        onClose={() => setShowCreate(false)}
        onCreate={async (input) => { await createLocation(input); }}
        onUpdate={async () => { /* unused in create mode */ }}
      />
      <LocationFormModal
        isOpen={!!editLocation}
        mode="edit"
        location={editLocation}
        onClose={() => setEditLocation(null)}
        onCreate={async () => { /* unused in edit mode */ }}
        onUpdate={async (id, input) => { await updateLocation(id, input); }}
      />
    </>
  );
```

Ensure `StockLocation` and `useState` are imported in this file (add to existing import lines if missing).

- [ ] **Step 4: Delete the old modal + update the barrel**

```bash
cd /home/hein/Workspace/FF_Next.js-wt/stock-locations-custody && git rm src/modules/procurement/field-stock/components/locations/CreateLocationModal.tsx
```

If `src/modules/procurement/field-stock/components/locations/index.ts` (or a `components/index.ts` barrel) exports `CreateLocationModal`, replace that export with `LocationFormModal`. Find it:

Run: `cd /home/hein/Workspace/FF_Next.js-wt/stock-locations-custody && grep -rn "CreateLocationModal" src pages`
Expected after edits: zero matches. Fix any remaining reference to import `LocationFormModal` instead.

- [ ] **Step 5: Type-check + build the affected page**

Run: `cd /home/hein/Workspace/FF_Next.js-wt/stock-locations-custody && npx tsc --noEmit`
Expected: no errors; no dangling `CreateLocationModal` references.

- [ ] **Step 6: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-wt/stock-locations-custody && git add -A src/modules/procurement/field-stock/components/locations pages/procurement/field-stock/index.tsx && git commit -m "feat(field-stock): edit locations via shared LocationFormModal"
```

---

## Task 4: Hide system/virtual locations from the admin list

**Files:**
- Modify: `src/modules/procurement/field-stock/components/locations/LocationList.tsx`

System/virtual locations (`technician`, `scrap`, `adjustment`) and any `isVirtual` row are managed by the system (technician handled in Sprint D), not by admins. Filter them out of the admin list and out of the type-filter chips.

- [ ] **Step 1: Add a hidden-types constant and filter the fetched list**

Near the top of `LocationList.tsx` (after the imports), add:

```tsx
const HIDDEN_ADMIN_TYPES: LocationType[] = ['technician', 'scrap', 'adjustment'];
```

After the `useLocations(...)` call, derive a visible list:

```tsx
  const visibleLocations = locations.filter(
    (l) => !HIDDEN_ADMIN_TYPES.includes(l.locationType) && !l.isVirtual,
  );
```

Then replace the two render references `locations.length` → `visibleLocations.length` and the `.map` source `locations.map` → `visibleLocations.map`.

- [ ] **Step 2: Hide the system types from the filter chips**

Replace the chip-rendering `Object.entries(locationTypeLabels).map(...)` so it skips hidden types:

```tsx
            {Object.entries(locationTypeLabels)
              .filter(([type]) => !HIDDEN_ADMIN_TYPES.includes(type as LocationType))
              .map(([type, label]) => (
```

(keep the rest of the chip JSX unchanged).

- [ ] **Step 3: Type-check**

Run: `cd /home/hein/Workspace/FF_Next.js-wt/stock-locations-custody && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-wt/stock-locations-custody && git add src/modules/procurement/field-stock/components/locations/LocationList.tsx && git commit -m "feat(field-stock): hide system/virtual locations from the admin list"
```

---

## Task 5: Create the Garstfontein DC hub (migration)

**Files:**
- Create: `scripts/migrations/sql/<version>_create_garstfontein_dc.sql`

- [ ] **Step 1: Pick the next migration version from the live DB (never from `ls`)**

Run (uses the env password — do not hard-code it in the file):
```bash
PGPASSWORD="$FF_PGPASSWORD" psql -h 100.96.203.105 -p 5436 -U postgres.ironman-platform -d fibreflow -At -c "SELECT MAX(version) FROM migrations;"
```
Use `<max>+1` as the numeric prefix. (Set `FF_PGPASSWORD` from `.claude/credentials.local.md` in your shell first; do not write it into any file.)

- [ ] **Step 2: Write the idempotent migration**

Create `scripts/migrations/sql/<version>_create_garstfontein_dc.sql`:

```sql
-- Create the central Garstfontein DC (Pretoria) as a top-level warehouse hub.
-- Idempotent: safe to re-run. No parent (top-level hub).
INSERT INTO stock_locations (code, name, location_type, address, is_active, is_virtual)
SELECT 'DC-GARST', 'Garstfontein DC', 'warehouse', 'Garstfontein, Pretoria', true, false
WHERE NOT EXISTS (
  SELECT 1 FROM stock_locations WHERE code = 'DC-GARST'
);
```

- [ ] **Step 3: Verify the live schema accepts these columns BEFORE running**

Run: `PGPASSWORD="$FF_PGPASSWORD" psql -h 100.96.203.105 -p 5436 -U postgres.ironman-platform -d fibreflow -c "\d stock_locations"`
Expected: confirms `code, name, location_type, address, is_active, is_virtual` columns exist (they do per the audit). Only run the migration through the project migration runner — do not hand-edit the DB.

- [ ] **Step 4: Apply via the migration runner, then confirm**

Apply using the repo's standard migration runner (the same one that records into `migrations`). Then:

Run: `PGPASSWORD="$FF_PGPASSWORD" psql -h 100.96.203.105 -p 5436 -U postgres.ironman-platform -d fibreflow -At -c "SELECT code, name, location_type FROM stock_locations WHERE code='DC-GARST';"`
Expected: `DC-GARST|Garstfontein DC|warehouse`

- [ ] **Step 5: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-wt/stock-locations-custody && git add scripts/migrations/sql/ && git commit -m "feat(stock): create Garstfontein DC central hub location"
```

---

## Task 6: Verification gates (CI + browser)

**Files:** none (verification only)

- [ ] **Step 1: Run the unit test + type-check + lint gate**

Run:
```bash
cd /home/hein/Workspace/FF_Next.js-wt/stock-locations-custody && npx vitest run src/modules/procurement/field-stock/__tests__/locationService.test.ts && npx tsc --noEmit && npm run ci:quick
```
Expected: tests PASS; `tsc` clean; `ci:quick` passes the lint ratchet (0 errors; warnings ≤ baseline). Per project rule, Vitest does not type-check — the explicit `tsc --noEmit` is mandatory.

- [ ] **Step 2: Browser-verify on local dev (mandatory for UI changes)**

Start dev and drive the Locations tab with the Playwright MCP (`mcp__playwriter__execute`), capturing screenshots:
```bash
cd /home/hein/Workspace/FF_Next.js-wt/stock-locations-custody && ln -sfn /home/hein/Workspace/FF_Next.js/node_modules node_modules && PORT=3004 npm run dev
```
Verify, with a screenshot at each step:
  1. `/procurement/field-stock` → Locations tab: **no** technician/scrap/adjustment rows appear.
  2. **Add Location** → fill name (auto-code), pick a parent, enter lat/lng → saves and appears in the list.
  3. **Edit** (pencil) an existing warehouse → code + type are disabled; change the address → saves and persists after refresh.
  4. **Garstfontein DC** appears in the list and is selectable as the receiving warehouse on `/procurement/grn/new`.
  5. Attempt to delete a location: with `stock_quants` empty today it will succeed; confirm the guard path returns the friendly 400 message by temporarily testing against a seeded quant (optional — the unit test already covers the rule).

- [ ] **Step 3: Open the PR**

```bash
cd /home/hein/Workspace/FF_Next.js-wt/stock-locations-custody && git push -u origin spec/stock-locations-custody-roadmap && gh pr create --fill --base master --title "feat(field-stock): location management v2 (Sprint B)"
```
Then follow the standing review-and-merge rule: invoke `/review` (use **review-team** — this is a multi-file code PR), wait for CI on the self-hosted runner, merge only after blind review APPROVED + CI green. **After merge, run `/handoff`** for a fresh session (per the roadmap's per-sprint rule) before starting Sprint A.

---

## Self-Review

**Spec coverage (Sprint B section of the roadmap):**
- Edit + soft-delete UI → Tasks 1 (guard), 3 (edit modal + affordance). ✓
- Delete/deactivate blocked when quants > 0 → Task 1. ✓
- Richer setup form (coordinates, parent hierarchy) → Tasks 2, 3. (`project_id` explicitly deferred to C/D — noted in scope.) ✓
- Hub/site taxonomy + real Garstfontein DC → Task 5 (DC) + parent picker (Task 2) expresses hierarchy. Tree-render UI deferred (YAGNI), noted. ✓
- Hide system/virtual locations from setup → Task 4. ✓
- Gates: edits persist; DC selectable in GRN; technician rows gone; `ci:quick` + `tsc` → Task 6. ✓

**Placeholder scan:** No "TBD/TODO" in implementation steps. The `<version>` token in Task 5 is intentional — it is resolved from `SELECT MAX(version)` at execution time per the migration-collision rule, not a placeholder for missing content. The "unused in X mode" no-op callbacks in Task 3 are deliberate (one modal instance per mode).

**Type consistency:** `LocationFormValue`, `toCreateInput`, `EMPTY_LOCATION_FORM`, `generateCode` defined in Task 2 and consumed unchanged in Task 3. `checkLocationDeletable`/`LocationDeletionCheck` defined and consumed in Task 1. `onEditLocation` prop added in Task 3 and used in the same task's page wiring. `CreateLocationInput.parentId`/`coordinates` and `UpdateLocationInput.coordinates` confirmed present in `types/index.ts`.
