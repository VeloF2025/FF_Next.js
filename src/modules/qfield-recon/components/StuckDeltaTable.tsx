import type { StuckDelta } from '../types';

export function StuckDeltaTable({ rows }: { rows: StuckDelta[] }) {
  if (rows.length === 0) return <p className="mt-6 text-sm text-gray-500">No stuck deltas.</p>;
  return (
    <section className="mt-6">
      <h3 className="mb-2 font-semibold">Stuck deltas ({rows.length})</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left text-gray-500">
            <th className="py-1 pr-4">Feature</th><th className="pr-4">Kind</th><th className="pr-4">Status</th>
            <th className="pr-4">Last status</th><th className="pr-4">Created (UTC)</th><th>Verdict</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.deltaId}>
                <td className="py-1 pr-4 font-mono text-xs">{r.label ?? r.featureKey}</td>
                <td className="pr-4">{r.kind}</td>
                <td className="pr-4">{r.status}</td>
                <td className="pr-4">{r.lastStatus}</td>
                <td className="pr-4">{r.createdAt.replace('T', ' ').replace('Z', '')}</td>
                <td>{r.supersededByAppliedTwin
                  ? <span className="text-gray-500">stale duplicate (recovered)</span>
                  : <span className="font-medium text-amber-700">genuinely stuck</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
