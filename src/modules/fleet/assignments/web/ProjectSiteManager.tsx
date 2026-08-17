import { useState } from 'react';
import type { AssignmentSourceOption } from '../rosterQueries';
import type { OperationalSite } from '../types';

interface SiteCreateInput {
  displayName: string; projectAoiId: string | null; authorizedLocationId: string | null; isDefault: boolean;
}

export function ProjectSiteManager({ sources, sites, onCreate, onUpdate }: {
  sources: AssignmentSourceOption[]; sites: OperationalSite[];
  onCreate: (input: SiteCreateInput) => Promise<void>;
  onUpdate: (siteId: string, input: { displayName?: string; isDefault?: boolean; isActive?: boolean }) => Promise<void>;
}) {
  const [name, setName] = useState(''); const [sourceKey, setSourceKey] = useState('');
  const [makeDefault, setMakeDefault] = useState(false); const [renames, setRenames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null); const selected = sources.find((source) => `${source.kind}:${source.id}` === sourceKey);
  async function create() {
    if (!selected) return;
    try {
      setError(null); await onCreate({ displayName: name.trim(), projectAoiId: selected.kind === 'aoi' ? selected.id : null, authorizedLocationId: selected.kind === 'location' ? selected.id : null, isDefault: makeDefault });
      setName(''); setSourceKey(''); setMakeDefault(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not create site'); }
  }
  async function update(siteId: string, input: { displayName?: string; isDefault?: boolean; isActive?: boolean }) {
    try { setError(null); await onUpdate(siteId, input); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not update site'); }
  }
  return <section className="space-y-3"><h2>Operational sites</h2>
    <select aria-label="Site source" value={sourceKey} onChange={(event) => setSourceKey(event.target.value)}><option value="">Select reviewed source</option>{sources.map((source) => <option key={`${source.kind}:${source.id}`} value={`${source.kind}:${source.id}`}>{source.kind === 'aoi' ? 'AOI' : 'Geofence'} · {source.label}</option>)}</select>
    {selected?.confidence && <p>Confidence: {selected.confidence}</p>}{selected?.warning && <p className="text-amber-300">{selected.warning}</p>}
    <input aria-label="Site name" value={name} onChange={(event) => setName(event.target.value)} placeholder={selected?.label ?? 'Display name'} />
    <label><input type="checkbox" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} /> Default site</label>
    <button type="button" onClick={() => void create()} disabled={!name.trim() || !selected}>Add site</button>
    <ul>{sites.map((site) => <li key={site.id}><span>{site.displayName}{site.isDefault ? ' · Default' : ''}{!site.isActive ? ' · Inactive' : ''}</span>{site.isActive && <><input aria-label={`Rename ${site.displayName}`} value={renames[site.id] ?? site.displayName} onChange={(event) => setRenames((current) => ({ ...current, [site.id]: event.target.value }))} /><button onClick={() => void update(site.id, { displayName: renames[site.id] ?? site.displayName })}>Rename</button>{!site.isDefault && <button aria-label={`Make ${site.displayName} default`} onClick={() => void update(site.id, { isDefault: true })}>Make default</button>}<button aria-label={`Deactivate ${site.displayName}`} onClick={() => void update(site.id, { isActive: false })}>Deactivate</button></>}</li>)}</ul>
    {error && <p role="alert">{error}</p>}
  </section>;
}
