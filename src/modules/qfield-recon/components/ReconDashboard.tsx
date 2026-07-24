'use client';
import type { ReconModel } from '../types';
import { BreakdownCards } from './BreakdownCards';
import { PonCompletenessTable } from './PonCompletenessTable';
import { StuckDeltaTable } from './StuckDeltaTable';
import { PhotoIntegrityList } from './PhotoIntegrityList';

export function ReconDashboard({ model }: { model: ReconModel }) {
  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-600">
        Design layer: {model.designLayer.available
          ? `resolved (${model.designLayer.gpkgVersion}) at ${model.designLayer.resolvedAt}`
          : 'unavailable — see notes'}
      </div>
      {model.notes.map((n, i) => <p key={i} className="rounded bg-amber-50 p-2 text-sm text-amber-800">{n}</p>)}
      <BreakdownCards totals={model.totals} />
      <PonCompletenessTable title="Optical (per PON — splitter pon_no)" rows={model.optical} />
      <PonCompletenessTable title="Civil (per PON — poles resolved via design layer)" rows={model.civil} />
      <StuckDeltaTable rows={model.stuckDeltas} />
      <PhotoIntegrityList flags={model.photoFlags} />
    </div>
  );
}
