import type { PonSummary } from '../types';

export function PonCompletenessTable({ title, rows }: { title: string; rows: PonSummary[] }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 font-semibold">{title}</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left text-gray-500">
            <th className="py-1 pr-4">PON</th><th className="pr-4">Design</th><th className="pr-4">Applied</th>
            <th className="pr-4">Stuck</th><th className="pr-4">Stale</th><th className="pr-4">Never captured</th><th>Missing photos</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={`${r.kind}-${r.ponNo ?? 'na'}`} className={r.neverCaptured > 0 ? 'bg-red-50' : ''}>
                <td className="py-1 pr-4 font-medium">{r.ponNo ?? '—'}</td>
                <td className="pr-4">{r.designFeatures || '—'}</td>
                <td className="pr-4 text-green-700">{r.applied}</td>
                <td className="pr-4 text-amber-700">{r.stuckRecoverable}</td>
                <td className="pr-4 text-gray-500">{r.staleDuplicate}</td>
                <td className="pr-4 text-red-700">{r.neverCaptured}</td>
                <td>{r.missingPhotos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
