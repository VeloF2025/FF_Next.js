import { useState, useEffect } from 'react';
import { log } from '@/lib/logger';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge } from '@/shared/components/ui/Badge';
import { Button } from '@/shared/components/ui/Button';
import { PhotoGalleryUnified } from '@/modules/activate/components/PhotoGalleryUnified';
import type { Photo, PhotoSource } from '@/modules/activate/types/unified.types';
import type { TrainingDrop } from '@/modules/vlm-training/services/trainingDataService';

const STEP_LABELS: Record<string, string> = {
  step_01_house_photo: 'House Photo',
  step_02_cable_from_pole: 'Cable from Pole',
  step_03_entry_outside: 'Entry Outside',
  step_04_entry_inside: 'Entry Inside',
  step_05_wall: 'Wall',
  step_06_ont_back: 'ONT Back',
  step_07_power_meter: 'Power Meter',
  step_08_final_installation: 'Final Installation',
  step_09_green_lights: 'Green Lights',
  step_10_signature: 'Signature',
  step_11_dome_joint_open: 'Dome Joint Open',
  step_12_dome_joint_closed: 'Dome Joint Closed',
};

function stepNameToNumber(step: unknown): number | null {
  if (step == null) return null;
  const match = String(step).match(/^step_(\d+)/);
  return match ? parseInt(match[1]!, 10) : null;
}

function buildPhotos(drop: TrainingDrop): Photo[] {
  const metadata = (drop.photos_metadata as unknown as Record<string, unknown>[]) ?? [];
  return metadata.map((m) => ({
    filename: String(m.filename ?? ''),
    url: String(m.url ?? ''),
    step: stepNameToNumber(m.step),
    size: m.size_bytes != null ? Number(m.size_bytes) : undefined,
  }));
}

export default function VlmTrainingDropPage() {
  const router = useRouter();
  const { dropNumber } = router.query;

  const [drop, setDrop] = useState<TrainingDrop | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [excluding, setExcluding] = useState(false);
  const [excludeReason, setExcludeReason] = useState('');
  const [showExcludeForm, setShowExcludeForm] = useState(false);

  useEffect(() => {
    if (!dropNumber || typeof dropNumber !== 'string') return;
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/vlm-training/${dropNumber}`, { signal: controller.signal, credentials: 'include' })
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setDrop(json.data);
        else setError('Drop not found');
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return;
        log.error('Failed to load training drop', { err }, 'vlm-training');
        setError('Failed to load drop');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [dropNumber]);

  const handleExclude = async () => {
    if (!drop || !excludeReason.trim()) return;
    setExcluding(true);
    try {
      const res = await fetch(`/api/vlm-training/${drop.drop_number}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: excludeReason }),
        credentials: 'include',
      });
      const json = await res.json();
      if (json.success) {
        setDrop({ ...drop, excluded_from_training: true, excluded_reason: excludeReason });
        setShowExcludeForm(false);
      } else {
        log.error('Failed to exclude training drop', { response: json }, 'vlm-training');
        setError('Failed to exclude drop. Please try again.');
      }
    } catch (err: unknown) {
      log.error('Failed to exclude training drop', { err }, 'vlm-training');
      setError('Failed to exclude drop. Please try again.');
    } finally {
      setExcluding(false);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </AppLayout>
    );
  }

  if (error || !drop) {
    return (
      <AppLayout>
        <div className="max-w-4xl mx-auto px-4 py-8">
          <Button variant="ghost" onClick={() => router.back()} className="mb-4">
            ← Back
          </Button>
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-destructive">
            {error ?? 'Drop not found'}
          </div>
        </div>
      </AppLayout>
    );
  }

  const photos = buildPhotos(drop);
  const stepsPresent = (drop.steps_present as Record<string, boolean>) ?? {};

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Nav */}
        <Button variant="ghost" onClick={() => router.push('/admin/vlm-training/sample')} className="mb-6">
          ← VLM Training Sample
        </Button>

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground font-mono">
              {drop.drop_number as string}
            </h1>
            <div className="flex items-center gap-3 mt-2">
              <Badge variant="outline">{drop.region as string}</Badge>
              <Badge variant="secondary">{drop.source as string}</Badge>
              <Badge
                variant="outline"
                className={
                  (drop.core_steps_present as number) >= 9
                    ? 'bg-green-500/20 text-green-400 border-green-500/30'
                    : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                }
              >
                {drop.core_steps_present as number}/9 core steps
              </Badge>
              {(drop.excluded_from_training as boolean) && (
                <Badge variant="destructive">Excluded from training</Badge>
              )}
            </div>
          </div>

          {!(drop.excluded_from_training as boolean) && (
            <Button
              variant="outline"
              
              className="text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={() => setShowExcludeForm(!showExcludeForm)}
            >
              Exclude from Training
            </Button>
          )}
        </div>

        {/* Exclude form */}
        {showExcludeForm && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 mb-6">
            <p className="text-sm text-muted-foreground mb-3">
              This drop will be removed from the active training set. Add a reason:
            </p>
            <div className="flex gap-3">
              <input
                type="text"
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="e.g. poor photo quality, wrong installation type..."
                value={excludeReason}
                onChange={(e) => setExcludeReason(e.target.value)}
              />
              <Button
                
                variant="danger"
                disabled={!excludeReason.trim() || excluding}
                onClick={handleExclude}
              >
                {excluding ? 'Excluding...' : 'Confirm Exclude'}
              </Button>
              <Button  variant="ghost" onClick={() => setShowExcludeForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Metadata grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Installer', value: (drop.installer_name as string | null) ?? '—' },
            {
              label: 'Install Date',
              value: drop.installation_date
                ? new Date(drop.installation_date as string).toLocaleDateString('en-ZA')
                : '—',
            },
            { label: 'Project', value: (drop.project_name as string | null) ?? '—' },
            {
              label: 'Location',
              value: (drop.location_address as string | null) ?? '—',
            },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <p className="text-sm text-foreground font-medium truncate" title={value}>
                {value}
              </p>
            </div>
          ))}
        </div>

        {/* Step checklist */}
        <div className="rounded-lg border border-border bg-card p-4 mb-8">
          <h2 className="text-sm font-medium text-foreground mb-3">Step Completion</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {Object.entries(STEP_LABELS).map(([key, label]) => {
              const present = stepsPresent[key];
              const isSignature = key === 'step_10_signature';
              return (
                <div
                  key={key}
                  className={`flex items-center gap-2 text-sm px-3 py-2 rounded-md border ${
                    present
                      ? 'border-green-500/30 bg-green-500/10 text-green-400'
                      : 'border-border bg-muted/30 text-muted-foreground'
                  }`}
                >
                  <span>{present ? '✓' : '○'}</span>
                  <span>{label}</span>
                  {isSignature && (
                    <span className="text-xs opacity-60">(excl.)</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Photos */}
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Photos ({photos.length})
        </h2>
        {photos.length > 0 ? (
          <PhotoGalleryUnified
            photos={photos}
            source={'onemap' as PhotoSource}
            groupByStep={true}
          />
        ) : (
          <div className="rounded-lg border border-border bg-muted/20 p-8 text-center text-muted-foreground">
            No photos in metadata. Photos may need to be fetched from OneMap.
          </div>
        )}
      </div>
    </AppLayout>
  );
}
