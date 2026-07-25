'use client';

import { AlertTriangle } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/components/ui/Tabs';
import type { ReconModel } from '../types';
import { BreakdownCards } from './BreakdownCards';
import { PonCompletenessTable } from './PonCompletenessTable';
import { StuckDeltaTable } from './StuckDeltaTable';
import { PhotoIntegrityList } from './PhotoIntegrityList';

interface ReconDashboardProps {
  model: ReconModel;
  isLoading?: boolean;
}

export function ReconDashboard({ model, isLoading }: ReconDashboardProps) {
  const opticalNeverCaptured = model.optical.reduce((sum, r) => sum + r.neverCaptured, 0);
  const civilNeverCaptured = model.civil.reduce((sum, r) => sum + r.neverCaptured, 0);
  const showBanner = !model.designLayer.available || model.notes.length > 0;

  return (
    <div className="space-y-6">
      {showBanner && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-600" />
            <div className="space-y-1 text-sm text-amber-600">
              {!model.designLayer.available && (
                <p className="font-medium">Design layer unavailable — PON/pole grouping is approximate.</p>
              )}
              {model.notes.map((n, i) => <p key={i}>{n}</p>)}
            </div>
          </div>
        </div>
      )}

      {model.designLayer.available && (
        <p className="text-xs text-[var(--ff-text-tertiary)]">
          Design layer resolved ({model.designLayer.gpkgVersion}) at {model.designLayer.resolvedAt}
        </p>
      )}

      <BreakdownCards
        totals={model.totals}
        opticalNeverCaptured={opticalNeverCaptured}
        civilNeverCaptured={civilNeverCaptured}
        isLoading={isLoading}
      />

      <Tabs defaultValue="optical" className="space-y-4">
        <TabsList>
          <TabsTrigger value="optical">Optical ({model.optical.length})</TabsTrigger>
          <TabsTrigger value="civil">Civil ({model.civil.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="optical">
          <PonCompletenessTable
            title="Optical — per PON (splitter pon_no)"
            rows={model.optical}
            isLoading={isLoading}
          />
        </TabsContent>
        <TabsContent value="civil">
          <PonCompletenessTable
            title="Civil — per PON (poles resolved via design layer)"
            rows={model.civil}
            isLoading={isLoading}
          />
        </TabsContent>
      </Tabs>

      <StuckDeltaTable rows={model.stuckDeltas} isLoading={isLoading} />
      <PhotoIntegrityList flags={model.photoFlags} isLoading={isLoading} />
    </div>
  );
}
