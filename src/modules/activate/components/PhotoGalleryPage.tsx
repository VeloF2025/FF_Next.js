'use client';

/**
 * Photo Gallery — Criteria Review
 *
 * Shows accepted photos (from PASS DRs) grouped by step.
 * QA manager reviews each photo and marks it as a GOOD example.
 * Marked photos become few-shot criteria examples for the PhotoGuide PWA VLM.
 *
 * Orchestrator: owns state + data loading and delegates rendering to
 * GalleryStepSidebar / PhotoGridView / PhotoSingleView.
 *
 * URL: /activate/photo-gallery
 */

import { useState, useEffect, useCallback } from 'react';
import { Loader2, XCircle, RefreshCw } from 'lucide-react';
import { log } from '@/lib/logger';
import { GalleryHeader } from './photo-gallery/GalleryHeader';
import { GalleryStepSidebar } from './photo-gallery/GalleryStepSidebar';
import { PhotoGridView } from './photo-gallery/PhotoGridView';
import { PhotoSingleView } from './photo-gallery/PhotoSingleView';
import { GalleryPhoto, PhotoDecision, StepCount, STEP_LABELS, photoKey } from './photo-gallery/types';

export default function PhotoGalleryPage() {
  const [activeStep, setActiveStep] = useState(1);
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [stepCounts, setStepCounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, PhotoDecision>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'grid' | 'single'>('grid');
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // Load step counts on mount. Counts are a secondary sidebar concern, so a
  // failure here is logged (not silently dropped) — the per-step load below
  // surfaces the user-facing error for the same endpoint/auth.
  useEffect(() => {
    fetch('/api/activate/photo-gallery?all=true', { credentials: 'include' })
      .then(async (r) => {
        const data = await r.json();
        if (r.ok && data.success && data.data?.counts) {
          const counts: Record<number, number> = {};
          (data.data.counts as StepCount[]).forEach((c) => {
            counts[c.step] = parseInt(String(c.photo_count), 10);
          });
          setStepCounts(counts);
        } else {
          log.warn('Photo gallery step counts unavailable', { status: r.status, error: data.error?.message }, 'PhotoGalleryPage');
        }
      })
      .catch((err) => {
        log.warn('Failed to load photo gallery step counts', { error: err instanceof Error ? err.message : String(err) }, 'PhotoGalleryPage');
      });
  }, []);

  // Load photos when step changes
  const loadPhotos = useCallback(async (step: number) => {
    setLoading(true);
    setPhotos([]);
    setCurrentIndex(0);
    setImageErrors({});
    setError(null);
    try {
      const res = await fetch(`/api/activate/photo-gallery?step=${step}&limit=60`, { credentials: 'include' });
      const data = await res.json();
      if (data.success && data.data?.photos) {
        setPhotos(data.data.photos);
      } else {
        setError(data.error?.message ?? 'Failed to load photos for this step.');
      }
    } catch (err) {
      log.error('Failed to load photo gallery photos', { step, error: err instanceof Error ? err.message : String(err) }, 'PhotoGalleryPage');
      setError('Could not load photos. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPhotos(activeStep);
  }, [activeStep, loadPhotos]);

  const toggleDecision = (key: string, decision: PhotoDecision) => {
    setDecisions((prev) => ({
      ...prev,
      [key]: prev[key] === decision ? null : decision,
    }));
  };

  const handleImageError = (key: string) => setImageErrors((prev) => ({ ...prev, [key]: true }));

  const goodPhotos = photos.filter((p) => decisions[photoKey(p)] === 'good');
  const badPhotos = photos.filter((p) => decisions[photoKey(p)] === 'bad');
  const goodCount = goodPhotos.length;
  const badCount = badPhotos.length;
  const undecidedCount = photos.length - goodCount - badCount;

  const copyResults = () => {
    const lines = [
      `Step ${activeStep}: ${STEP_LABELS[activeStep]}`,
      `Total reviewed: ${photos.length} | Good: ${goodCount} | Bad: ${badCount} | Undecided: ${undecidedCount}`,
      '',
      '=== GOOD EXAMPLES ===',
      ...goodPhotos.map((p) => `  ${p.drNumber}/${p.filename} (conf: ${(p.confidence * 100).toFixed(0)}%)`),
      '',
      '=== BAD EXAMPLES ===',
      ...badPhotos.map((p) => `  ${p.drNumber}/${p.filename} (conf: ${(p.confidence * 100).toFixed(0)}%)`),
    ];
    void navigator.clipboard.writeText(lines.join('\n'));
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <GalleryHeader
        viewMode={viewMode}
        onSetViewMode={setViewMode}
        goodCount={goodCount}
        badCount={badCount}
        onCopyResults={copyResults}
      />

      <div className="flex h-[calc(100vh-73px)]">
        <GalleryStepSidebar activeStep={activeStep} stepCounts={stepCounts} onSelectStep={setActiveStep} />

        {/* Main content */}
        <div className="flex-1 overflow-y-auto">
          {/* Step header */}
          <div className="sticky top-0 z-10 border-b border-gray-800 bg-gray-900/95 backdrop-blur px-6 py-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-white">
                  Step {activeStep}: {STEP_LABELS[activeStep]}
                </h2>
                <p className="text-sm text-gray-400">
                  {photos.length} photos loaded{' '}
                  {photos.length > 0 && (
                    <span>
                      · <span className="text-green-400">{goodCount} good</span>
                      {badCount > 0 && <span> · <span className="text-red-400">{badCount} bad</span></span>}
                      {undecidedCount > 0 && <span> · {undecidedCount} undecided</span>}
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={() => void loadPhotos(activeStep)}
                className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-400 hover:text-white"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reload
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : error ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-red-400">
              <XCircle className="h-8 w-8" />
              <span>{error}</span>
            </div>
          ) : photos.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-gray-500">
              No photos available for this step
            </div>
          ) : viewMode === 'grid' ? (
            <PhotoGridView
              photos={photos}
              decisions={decisions}
              imageErrors={imageErrors}
              activeStep={activeStep}
              onOpenSingle={(idx) => {
                setCurrentIndex(idx);
                setViewMode('single');
              }}
              onToggleDecision={toggleDecision}
              onImageError={handleImageError}
            />
          ) : (
            <PhotoSingleView
              photos={photos}
              currentIndex={currentIndex}
              decisions={decisions}
              imageErrors={imageErrors}
              activeStep={activeStep}
              onSetIndex={setCurrentIndex}
              onToggleDecision={toggleDecision}
              onImageError={handleImageError}
            />
          )}
        </div>
      </div>
    </div>
  );
}
