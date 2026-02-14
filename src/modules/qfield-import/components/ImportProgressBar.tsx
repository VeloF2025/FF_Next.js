import { CheckCircle, Loader2 } from 'lucide-react';
import type { ImportResult, LayerType } from '../types';

interface ImportProgressBarProps {
  result: ImportResult | null;
  importing: boolean;
}

const LAYER_LABELS: Record<string, string> = {
  poles: 'Poles',
  joints: 'Joints',
  cable_spans: 'Cable Spans',
  drops: 'Drops',
  zone_boundaries: 'Zone Boundaries',
  pon_boundaries: 'PON Boundaries',
  pops: 'POPs',
};

export function ImportProgressBar({ result, importing }: ImportProgressBarProps) {
  if (importing) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <Loader2 className="w-10 h-10 animate-spin text-blue-400 mb-3" />
        <p className="text-sm font-medium text-[var(--ff-text-primary)]">Importing layers...</p>
        <p className="text-xs text-[var(--ff-text-secondary)] mt-1">
          This may take a minute for large datasets
        </p>
      </div>
    );
  }

  if (!result) return null;

  const entries = Object.entries(result.results) as [LayerType, { created: number; updated: number }][];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <CheckCircle className="w-5 h-5 text-green-400" />
        <span className="text-sm font-medium text-green-400">Import Complete</span>
      </div>

      {entries.map(([layer, counts]) => (
        <div
          key={layer}
          className="flex items-center justify-between p-3 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]"
        >
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
            <span className="text-sm text-[var(--ff-text-primary)]">
              {LAYER_LABELS[layer] || layer}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-green-400">
              {counts.created.toLocaleString()} created
            </span>
            <span className="text-blue-400">
              {counts.updated.toLocaleString()} updated
            </span>
          </div>
        </div>
      ))}

      {entries.length === 0 && (
        <p className="text-sm text-[var(--ff-text-secondary)] text-center py-4">
          No layers were imported
        </p>
      )}
    </div>
  );
}
