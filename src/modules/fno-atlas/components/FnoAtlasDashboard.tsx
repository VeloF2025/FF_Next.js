import { GitBranch, MapPin, Network, RadioTower, Search, type LucideIcon } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { fnoNetworks, projectArchetypes, scrapingTools } from '../data/fnoAtlasData';
import type { FnoNetwork } from '../data/fnoAtlasData';
import { filterFnos, findFnosForProject, getAllRegions, getCoverageConfidenceSummary } from '../lib/fnoAtlasUtils';
import { FnoCoverageEvidencePanel } from './FnoCoverageEvidencePanel';
const FnoInteractiveMap = dynamic(
  () => import('./FnoInteractiveMap').then((module) => module.FnoInteractiveMap),
  { ssr: false, loading: () => <div className="rounded-2xl border p-6">Loading interactive map...</div> }
);
const cardStyle = {
  backgroundColor: 'var(--ff-surface)',
  borderColor: 'var(--ff-border-subtle)',
  color: 'var(--ff-text-primary)',
};
const defaultProjectId = projectArchetypes[0]?.id ?? '';
const defaultFnoId = fnoNetworks[0]?.id ?? '';
function Pill({ children }: { children: ReactNode }) {
  return (
    <span
      className="rounded-full border px-2.5 py-1 text-xs font-medium"
      style={{ borderColor: 'var(--ff-border-subtle)', color: 'var(--ff-text-secondary)' }}
    >
      {children}
    </span>
  );
}
function MetricCard({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <div className="rounded-2xl border p-4 shadow-sm" style={cardStyle}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm" style={{ color: 'var(--ff-text-secondary)' }}>{label}</p>
          <p className="mt-2 text-3xl font-semibold">{value}</p>
        </div>
        <Icon className="h-9 w-9" style={{ color: 'var(--ff-primary)' }} />
      </div>
    </div>
  );
}
function FnoCard({ network }: { network: FnoNetwork }) {
  return (
    <article className="rounded-2xl border p-5 shadow-sm" style={cardStyle}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">{network.name}</h3>
          <p className="mt-1 text-sm leading-6" style={{ color: 'var(--ff-text-secondary)' }}>
            {network.footprint}
          </p>
        </div>
        <span
          className="rounded-full px-3 py-1 text-xs font-semibold"
          style={{ backgroundColor: 'var(--ff-surface-alt)', color: 'var(--ff-text-primary)' }}
        >
          {network.confidence}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {network.types.map((type) => <Pill key={type}>{type}</Pill>)}
      </div>
      <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <div>
          <p className="font-medium">Best project fit</p>
          <p className="mt-1" style={{ color: 'var(--ff-text-secondary)' }}>{network.projectFit.join(', ')}</p>
        </div>
        <div>
          <p className="font-medium">Backhaul note</p>
          <p className="mt-1" style={{ color: 'var(--ff-text-secondary)' }}>{network.backhaulNotes}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <a href={network.website} target="_blank" rel="noreferrer" style={{ color: 'var(--ff-primary)' }}>
          Website
        </a>
        <a href={network.coverageSource} target="_blank" rel="noreferrer" style={{ color: 'var(--ff-primary)' }}>
          Coverage source
        </a>
        <span style={{ color: 'var(--ff-text-tertiary)' }}>{network.dataMethod}</span>
      </div>
    </article>
  );
}
function ProjectFitPanel({ selectedId, onSelect }: { selectedId: string; onSelect: (id: string) => void }) {
  const selected = projectArchetypes.find((item) => item.id === selectedId) ?? projectArchetypes[0]!;
  const matches = findFnosForProject(selected.id);
  return (
    <section className="rounded-2xl border p-5" style={cardStyle}>
      <div className="flex items-center gap-2">
        <GitBranch className="h-5 w-5" style={{ color: 'var(--ff-primary)' }} />
        <h2 className="text-xl font-semibold">Project-fit matcher</h2>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {projectArchetypes.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className="rounded-xl border p-3 text-left text-sm transition hover:shadow-md"
            style={{
              borderColor: item.id === selected.id ? 'var(--ff-primary)' : 'var(--ff-border-subtle)',
              backgroundColor: item.id === selected.id ? 'var(--ff-surface-alt)' : 'var(--ff-surface)',
              color: 'var(--ff-text-primary)',
            }}
          >
            <span className="font-semibold">{item.label}</span>
            <span className="mt-1 block" style={{ color: 'var(--ff-text-secondary)' }}>{item.description}</span>
          </button>
        ))}
      </div>
      <div className="mt-5 rounded-xl border p-4" style={{ borderColor: 'var(--ff-border-subtle)' }}>
        <p className="font-medium">Recommended FNOs: {matches.map((item) => item.name).join(' • ')}</p>
        <p className="mt-2 text-sm" style={{ color: 'var(--ff-text-secondary)' }}>{selected.backhaulPriority}</p>
      </div>
    </section>
  );
}
export function FnoAtlasDashboard() {
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('all');
  const [type, setType] = useState('all');
  const [selectedProject, setSelectedProject] = useState(defaultProjectId);
  const [selectedFnos, setSelectedFnos] = useState<string[]>(defaultFnoId ? [defaultFnoId] : []);
  const regions = useMemo(() => getAllRegions(), []);
  const filtered = useMemo(() => filterFnos(query, region, type), [query, region, type]);
  const confidence = getCoverageConfidenceSummary();
  useEffect(() => {
    setSelectedFnos((current) => {
      const filteredIds = new Set(filtered.map((network) => network.id));
      const stillVisible = current.filter((id) => filteredIds.has(id));
      if (stillVisible.length > 0) return stillVisible;
      return filtered[0]?.id ? [filtered[0].id] : [];
    });
  }, [filtered]);
  const toggleSelectedFno = (id: string) => {
    setSelectedFnos((current) => {
      if (current.includes(id)) {
        return current.length > 1 ? current.filter((item) => item !== id) : current;
      }
      return [...current, id];
    });
  };
  return (
    <div className="space-y-6 p-6">
      <header className="rounded-3xl border p-6 shadow-sm" style={cardStyle}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <MapPin className="h-8 w-8" style={{ color: 'var(--ff-primary)' }} />
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--ff-primary)' }}>FNO Atlas</p>
                <h1 className="text-3xl font-bold">SA network fit and backhaul intelligence</h1>
              </div>
            </div>
            <p className="mt-4 max-w-3xl text-sm leading-6" style={{ color: 'var(--ff-text-secondary)' }}>
              Map which Fibre Network Operator suits each project type, including township, rural and low-LSM rollouts where prepaid access and backhaul cost decide viability.
            </p>
          </div>
          <div className="grid min-w-[280px] grid-cols-3 gap-3">
            <MetricCard label="FNOs" value={String(fnoNetworks.length)} icon={Network} />
            <MetricCard label="High" value={String(confidence.High)} icon={RadioTower} />
            <MetricCard label="Verify" value={String(confidence['Needs verification'])} icon={Search} />
          </div>
        </div>
      </header>
      <FnoCoverageEvidencePanel />
      <ProjectFitPanel selectedId={selectedProject} onSelect={setSelectedProject} />
      <FnoInteractiveMap networks={filtered} selectedIds={selectedFnos} onToggle={toggleSelectedFno} />
      <section className="rounded-2xl border p-5" style={cardStyle}>
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_220px]">
          <label className="text-sm font-medium">
            Search FNO, region, project or backhaul
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="mt-2 w-full rounded-xl border px-3 py-2 outline-none"
              style={{ borderColor: 'var(--ff-border-subtle)', backgroundColor: 'var(--ff-surface-alt)' }}
              placeholder="DFA, Fibertime, low-LSM, backhaul..."
            />
          </label>
          <label className="text-sm font-medium">
            Region
            <select value={region} onChange={(event) => setRegion(event.target.value)} className="mt-2 w-full rounded-xl border px-3 py-2" style={{ borderColor: 'var(--ff-border-subtle)', backgroundColor: 'var(--ff-surface-alt)' }}>
              <option value="all">All regions</option>
              {regions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">
            Network type
            <select value={type} onChange={(event) => setType(event.target.value)} className="mt-2 w-full rounded-xl border px-3 py-2" style={{ borderColor: 'var(--ff-border-subtle)', backgroundColor: 'var(--ff-surface-alt)' }}>
              <option value="all">All types</option>
              <option value="FTTH">FTTH</option>
              <option value="FTTB">FTTB</option>
              <option value="Metro Backhaul">Metro Backhaul</option>
              <option value="National Backhaul">National Backhaul</option>
            </select>
          </label>
        </div>
      </section>
      <section className="grid gap-4 xl:grid-cols-2">
        {filtered.map((network) => <FnoCard key={network.id} network={network} />)}
      </section>

      <section className="rounded-2xl border p-5" style={cardStyle}>
        <h2 className="text-xl font-semibold">Scraping and data tooling decision</h2>
        <div className="mt-4 grid gap-3 lg:grid-cols-5">
          {scrapingTools.map((tool) => (
            <div key={tool.name} className="rounded-xl border p-4" style={{ borderColor: 'var(--ff-border-subtle)' }}>
              <p className="font-semibold">{tool.name}</p>
              <p className="mt-1 text-sm" style={{ color: 'var(--ff-primary)' }}>{tool.verdict}</p>
              <p className="mt-2 text-sm" style={{ color: 'var(--ff-text-secondary)' }}>{tool.notes}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
