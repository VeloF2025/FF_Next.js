import { useEffect, useState } from 'react';

type OperatorCoverageSummary = {
  operator_slug: string;
  operator_name: string;
  brand_color: string | null;
  coverage_polygons: number;
  coverage_km2: string | null;
  presence_points: number;
  last_seen_at: string | null;
};

type OverlaySummary = {
  match_type: string;
  count: number;
};

type ProjectOverlay = {
  project_code: string | null;
  project_name: string | null;
  operator_slug: string;
  operator_name: string;
  match_type: string;
  distance_m: string | null;
  fit_score: string;
  evidence: { gpsDropCount?: number; basis?: string };
};

type CoverageSummaryResponse = {
  operatorCoverage: OperatorCoverageSummary[];
  overlaySummary: OverlaySummary[];
  projectOverlays: ProjectOverlay[];
};

const cardStyle = {
  backgroundColor: 'var(--ff-surface)',
  borderColor: 'var(--ff-border-subtle)',
  color: 'var(--ff-text-primary)',
};

function formatDistance(value: string | null): string {
  if (!value) return 'n/a';
  const meters = Number(value);
  if (!Number.isFinite(meters)) return 'n/a';
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

export function FnoCoverageEvidencePanel() {
  const [data, setData] = useState<CoverageSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/fno-atlas/coverage-summary')
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (active) setData(payload.data as CoverageSummaryResponse);
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      });
    return () => { active = false; };
  }, []);

  const polygonCount = data?.operatorCoverage.reduce((total, item) => total + item.coverage_polygons, 0) ?? 0;
  const presenceCount = data?.operatorCoverage.reduce((total, item) => total + item.presence_points, 0) ?? 0;
  const liveOperators = data?.operatorCoverage.filter((item) => item.coverage_polygons > 0 || item.presence_points > 0) ?? [];

  return (
    <section className="rounded-2xl border p-5" style={cardStyle}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Live GIS evidence layer</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--ff-text-secondary)' }}>
            Database-backed polygons and computed project overlays. Zero rows means no verified coverage yet, not a hidden assumption.
          </p>
        </div>
        <div className="rounded-xl border px-4 py-2 text-right" style={{ borderColor: 'var(--ff-border-subtle)' }}>
          <p className="text-2xl font-semibold">{polygonCount}</p>
          <p className="text-xs" style={{ color: 'var(--ff-text-secondary)' }}>
            polygons · {presenceCount} presence points
          </p>
        </div>
      </div>

      {error && <p className="mt-4 text-sm" style={{ color: 'var(--ff-error)' }}>Could not load GIS summary: {error}</p>}
      {!data && !error && <p className="mt-4 text-sm" style={{ color: 'var(--ff-text-secondary)' }}>Loading source-backed coverage summary...</p>}

      {data && (
        <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_1.4fr]">
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--ff-border-subtle)' }}>
            <h3 className="font-semibold">Imported coverage sources</h3>
            <div className="mt-3 space-y-3">
              {liveOperators.map((item) => (
                <div key={item.operator_slug} className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.brand_color || 'var(--ff-primary)' }} />
                    <span>{item.operator_name}</span>
                  </div>
                  <span style={{ color: 'var(--ff-text-secondary)' }}>
                    {item.coverage_polygons} polygons · {item.presence_points} points · {item.coverage_km2} km²
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--ff-border-subtle)' }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold">Project overlay results</h3>
              <div className="flex gap-2 text-xs" style={{ color: 'var(--ff-text-secondary)' }}>
                {data.overlaySummary.map((item) => <span key={item.match_type}>{item.match_type}: {item.count}</span>)}
              </div>
            </div>
            <div className="mt-3 max-h-72 overflow-auto rounded-lg border" style={{ borderColor: 'var(--ff-border-subtle)' }}>
              <table className="w-full text-left text-sm">
                <thead style={{ backgroundColor: 'var(--ff-surface-alt)' }}>
                  <tr>
                    <th className="px-3 py-2">Project</th>
                    <th className="px-3 py-2">FNO</th>
                    <th className="px-3 py-2">Result</th>
                    <th className="px-3 py-2">Nearest</th>
                    <th className="px-3 py-2">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {data.projectOverlays.map((item) => (
                    <tr key={`${item.project_code}-${item.operator_slug}`} className="border-t" style={{ borderColor: 'var(--ff-border-subtle)' }}>
                      <td className="px-3 py-2">{item.project_name || item.project_code}</td>
                      <td className="px-3 py-2">{item.operator_name}</td>
                      <td className="px-3 py-2">{item.match_type}</td>
                      <td className="px-3 py-2">{formatDistance(item.distance_m)}</td>
                      <td className="px-3 py-2">{item.fit_score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
