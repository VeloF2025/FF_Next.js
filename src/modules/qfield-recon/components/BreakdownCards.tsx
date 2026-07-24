import type { ReconModel } from '../types';

const CARDS: Array<{ key: keyof ReconModel['totals']; label: string; tone: string }> = [
  { key: 'applied', label: 'Applied ✓', tone: 'text-green-600' },
  { key: 'stuckRecoverable', label: 'Stuck (recoverable)', tone: 'text-amber-600' },
  { key: 'neverCaptured', label: 'Never captured', tone: 'text-red-600' },
  { key: 'staleDuplicate', label: 'Stale duplicates (recovered)', tone: 'text-gray-500' },
];

export function BreakdownCards({ totals }: { totals: ReconModel['totals'] }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {CARDS.map(c => (
        <div key={c.key} className="rounded-lg border p-4">
          <div className={`text-3xl font-bold ${c.tone}`}>{totals[c.key]}</div>
          <div className="text-sm text-gray-600">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
