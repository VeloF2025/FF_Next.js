import dynamic from 'next/dynamic';
import { FormEvent, useEffect, useState } from 'react';
import type { AuthorizedLocation, LocationType } from '../types';
import { createLocation, updateLocation } from './locationApi';
import { LOCATION_TYPES, LocationInput, LocationValidationErrors, validateLocationInput } from './locationRules';

const LocationMapPicker = dynamic(
  () => import('./LocationMapPicker').then((module) => module.LocationMapPicker),
  { ssr: false }
);

interface Props {
  mode: 'create' | 'edit';
  location: AuthorizedLocation | null;
  onClose: () => void;
  onSaved: (location: AuthorizedLocation) => void;
}

const inputClass = 'w-full rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] px-3 py-2 text-[var(--ff-text-primary)]';

export function LocationFormModal({ mode, location, onClose, onSaved }: Props) {
  const [vehicles, setVehicles] = useState<Array<{ id: string; registration: string }>>([]);
  const [input, setInput] = useState<LocationInput>({
    name: location?.name ?? '',
    lat: location?.lat ?? Number.NaN,
    lon: location?.lon ?? Number.NaN,
    radiusKm: location?.radiusKm ?? 1,
    locationType: location?.locationType ?? 'work_site',
    isGlobal: location?.isGlobal ?? true,
    vehicleId: location?.vehicleId ?? null,
  });
  const [errors, setErrors] = useState<LocationValidationErrors>({});
  const [requestError, setRequestError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (input.isGlobal || vehicles.length > 0) return;
    let cancelled = false;
    void fetch('/api/fleet/vehicles?status=active').then(async (response) => {
      const payload = await response.json() as { data?: Array<{ id: string; registration: string }> };
      if (!response.ok) throw new Error('Failed to load vehicles');
      if (!cancelled) setVehicles(payload.data ?? []);
    }).catch(() => { if (!cancelled) setRequestError('Failed to load vehicles'); });
    return () => { cancelled = true; };
  }, [input.isGlobal, vehicles.length]);

  const setNumber = (field: 'lat' | 'lon' | 'radiusKm', value: string) => {
    setInput((current) => ({ ...current, [field]: value === '' ? Number.NaN : Number(value) }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = validateLocationInput(input);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSaving(true);
    setRequestError(null);
    try {
      const saved = mode === 'create'
        ? await createLocation(input)
        : await updateLocation(location!.id, input);
      onSaved(saved);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Location request failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={`${mode} location`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form onSubmit={submit} className="max-h-[95vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl bg-[var(--ff-bg-secondary)] p-6">
        <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">{mode === 'create' ? 'Add location' : 'Edit location'}</h2>
        <label className="block">Name<input aria-label="Name" className={inputClass} value={input.name} onChange={(e) => setInput({ ...input, name: e.target.value })} />{errors.name && <span className="text-sm text-red-600">{errors.name}</span>}</label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label>Latitude<input aria-label="Latitude" type="number" step="any" className={inputClass} value={Number.isFinite(input.lat) ? input.lat : ''} onChange={(e) => setNumber('lat', e.target.value)} />{errors.lat && <span className="text-sm text-red-600">{errors.lat}</span>}</label>
          <label>Longitude<input aria-label="Longitude" type="number" step="any" className={inputClass} value={Number.isFinite(input.lon) ? input.lon : ''} onChange={(e) => setNumber('lon', e.target.value)} />{errors.lon && <span className="text-sm text-red-600">{errors.lon}</span>}</label>
          <label>Radius (km)<input aria-label="Radius (km)" type="number" step="0.1" className={inputClass} value={input.radiusKm} onChange={(e) => setNumber('radiusKm', e.target.value)} />{errors.radiusKm && <span className="text-sm text-red-600">{errors.radiusKm}</span>}</label>
        </div>
        <label className="block">Location type<select aria-label="Location type" className={inputClass} value={input.locationType} onChange={(e) => setInput({ ...input, locationType: e.target.value as LocationType })}>{LOCATION_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={input.isGlobal} onChange={(e) => setInput({ ...input, isGlobal: e.target.checked, vehicleId: e.target.checked ? null : input.vehicleId })} />Global location</label>
        {!input.isGlobal && <label className="block">Vehicle<select aria-label="Vehicle" className={inputClass} value={input.vehicleId ?? ''} onChange={(e) => setInput({ ...input, vehicleId: e.target.value || null })}><option value="">Select a vehicle</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.registration}</option>)}</select>{errors.vehicleId && <span className="text-sm text-red-600">{errors.vehicleId}</span>}</label>}
        <LocationMapPicker lat={input.lat} lon={input.lon} radiusKm={input.radiusKm} onChange={(coordinates) => setInput({ ...input, ...coordinates })} />
        {requestError && <p className="text-sm text-red-600">{requestError}</p>}
        <div className="flex justify-end gap-3"><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={saving} className="rounded-lg bg-[var(--ff-primary)] px-4 py-2 text-white disabled:opacity-50">{saving ? 'Saving…' : mode === 'create' ? 'Create location' : 'Save changes'}</button></div>
      </form>
    </div>
  );
}
