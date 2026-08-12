import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Car, Globe, MapPin, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { usePermission } from '@/hooks/usePermission';
import { fleetConfig } from '@/modules/navigation';
import type { AuthorizedLocation } from '@/modules/fleet/types';
import { LocationFormModal } from '@/modules/fleet/locations/LocationFormModal';
import { deactivateLocation, listLocations, reactivateLocation } from '@/modules/fleet/locations/locationApi';

type ModalState = { mode: 'create'; location: null } | { mode: 'edit'; location: AuthorizedLocation } | null;

function LocationSection({ title, icon: Icon, locations, canEdit, canDelete, onEdit, onDeactivate, onReactivate }: {
  title: string; icon: typeof Globe; locations: AuthorizedLocation[]; canEdit: boolean; canDelete: boolean;
  onEdit: (location: AuthorizedLocation) => void; onDeactivate: (location: AuthorizedLocation) => void; onReactivate: (location: AuthorizedLocation) => void;
}) {
  return <section className="rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
    <header className="flex items-center gap-2 border-b border-[var(--ff-border-light)] px-6 py-4"><Icon className="h-5 w-5 text-[var(--ff-primary)]" /><h2 className="font-semibold">{title}</h2><span>({locations.length})</span></header>
    {locations.length === 0 ? <p className="p-8 text-center text-[var(--ff-text-secondary)]">No locations</p> : locations.map((location) =>
      <div key={location.id} className="flex items-center justify-between border-b border-[var(--ff-border-light)] px-6 py-4 last:border-0">
        <div><p className="font-medium">{location.name}</p><p className="text-sm text-[var(--ff-text-secondary)]">{location.lat.toFixed(4)}, {location.lon.toFixed(4)} · {location.radiusKm}km radius</p></div>
        <div className="flex items-center gap-2">{!location.isActive && <span className="text-xs">Inactive</span>}
          {location.isActive && canEdit && <button aria-label={`Edit ${location.name}`} onClick={() => onEdit(location)} className="p-2"><Pencil className="h-4 w-4" /></button>}
          {location.isActive && canDelete && <button aria-label={`Deactivate ${location.name}`} onClick={() => onDeactivate(location)} className="p-2 text-red-600"><Trash2 className="h-4 w-4" /></button>}
          {!location.isActive && canEdit && <button aria-label={`Reactivate ${location.name}`} onClick={() => onReactivate(location)} className="p-2"><RotateCcw className="h-4 w-4" /></button>}
        </div>
      </div>)}
  </section>;
}

export default function FleetLocationsPage() {
  const [locations, setLocations] = useState<AuthorizedLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const { can, isLoading: permissionsLoading } = usePermission();
  const canCreate = !permissionsLoading && can('fleet.locations', 'create');
  const canEdit = !permissionsLoading && can('fleet.locations', 'edit');
  const canDelete = !permissionsLoading && can('fleet.locations', 'delete');

  const loadLocations = useCallback(async () => {
    setLoading(true); setError(null);
    try { setLocations(await listLocations(showInactive)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Failed to load locations'); }
    finally { setLoading(false); }
  }, [showInactive]);

  useEffect(() => { void loadLocations(); }, [loadLocations]);

  const mutate = async (operation: () => Promise<unknown>) => {
    setError(null);
    try { await operation(); await loadLocations(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Location request failed'); }
  };

  const filtered = locations.filter((location) => location.name.toLowerCase().includes(search.toLowerCase()));
  const sectionProps = { canEdit, canDelete, onEdit: (location: AuthorizedLocation) => setModal({ mode: 'edit', location }), onDeactivate: (location: AuthorizedLocation) => { if (window.confirm(`Deactivate ${location.name}?`)) void mutate(() => deactivateLocation(location.id)); }, onReactivate: (location: AuthorizedLocation) => void mutate(() => reactivateLocation(location.id)) };

  return <AppLayout><ModulePage config={fleetConfig} hideTabs><div className="space-y-6 p-6">
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold">Authorized Locations</h1><p className="text-[var(--ff-text-secondary)]">Configure geofencing zones for trip classification</p></div>{canCreate && <button aria-label="Add location" onClick={() => setModal({ mode: 'create', location: null })} className="flex items-center gap-2 rounded-lg bg-[var(--ff-primary)] px-4 py-2 text-white"><Plus className="h-4 w-4" />Add Location</button>}</div>
    <div className="flex gap-4"><label className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4" /><input aria-label="Search locations" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-lg border py-2 pl-10" /></label><label className="flex items-center gap-2"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />Show inactive</label></div>
    {error && <p role="alert" className="flex gap-2 text-red-600"><AlertTriangle className="h-5 w-5" />{error}</p>}
    {loading ? <p>Loading locations…</p> : <div className="space-y-6"><LocationSection title="Global Locations" icon={Globe} locations={filtered.filter((location) => location.isGlobal)} {...sectionProps} /><LocationSection title="Vehicle-Specific Locations" icon={Car} locations={filtered.filter((location) => !location.isGlobal)} {...sectionProps} /></div>}
    {filtered.length === 0 && !loading && !error && <div className="text-center"><MapPin className="mx-auto h-8 w-8" />No matching locations</div>}
    {modal && <LocationFormModal mode={modal.mode} location={modal.location} onClose={() => setModal(null)} onSaved={() => { setModal(null); void loadLocations(); }} />}
  </div></ModulePage></AppLayout>;
}
