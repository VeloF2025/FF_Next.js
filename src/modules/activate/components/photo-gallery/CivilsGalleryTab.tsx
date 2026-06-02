'use client';

/**
 * CivilsGalleryTab — Civils photo curation tab for the Photo Gallery page.
 *
 * Fetches civils photos from /api/activate/civil-photo-gallery, lets the QA
 * manager toggle positive/negative labels, and saves decisions via
 * POST /api/activate/civil-photo-gallery/save-decisions.
 */

import { useState, useEffect, useCallback } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { log } from '@/lib/logger';
import { CIVIL_STEP_LABELS, CIVIL_STEPS } from '@/modules/sitecam/lib/sitecamSteps';
import type { CivilGalleryPhoto } from '@/pages/api/activate/civil-photo-gallery/index';
import { CivilPhotoGrid } from './CivilPhotoGrid';

type CivilLabel = 'positive' | 'negative';
type PendingDecision = 'good' | 'bad';

export function CivilsGalleryTab() {
  const [activeStep, setActiveStep] = useState(1);
  const [photos, setPhotos] = useState<CivilGalleryPhoto[]>([]);
  const [stepCounts, setStepCounts] = useState<Record<number, number>>({});
  const [pendingChanges, setPendingChanges] = useState<Record<string, PendingDecision>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load step counts on mount
  useEffect(() => {
    fetch('/api/activate/civil-photo-gallery?all=true', { credentials: 'include' })
      .then(async (r) => {
        const data = await r.json();
        if (r.ok && data.success && data.data?.counts) {
          const counts: Record<number, number> = {};
          (data.data.counts as { step_number: number; photo_count: string }[]).forEach((c) => {
            counts[c.step_number] = parseInt(String(c.photo_count), 10);
          });
          setStepCounts(counts);
        } else {
          log.warn('Civil gallery step counts unavailable', { status: r.status }, 'CivilsGalleryTab');
        }
      })
      .catch((err) => {
        log.warn('Failed to load civil gallery step counts', { error: err instanceof Error ? err.message : String(err) }, 'CivilsGalleryTab');
      });
  }, []);

  const loadPhotos = useCallback(async (step: number) => {
    setLoading(true);
    setPhotos([]);
    setError(null);
    try {
      const res = await fetch(`/api/activate/civil-photo-gallery?step=${step}&limit=60`, { credentials: 'include' });
      const data = await res.json();
      if (data.success && data.data?.photos) {
        setPhotos(data.data.photos as CivilGalleryPhoto[]);
      } else {
        setError(data.error?.message ?? 'Failed to load photos for this step.');
      }
    } catch (err) {
      log.error('Failed to load civil gallery photos', { step, error: err instanceof Error ? err.message : String(err) }, 'CivilsGalleryTab');
      setError('Could not load photos. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPhotos(activeStep);
    setPendingChanges({});
  }, [activeStep, loadPhotos]);

  const toggleLabel = (id: string, current: CivilLabel) => {
    setPendingChanges((prev) => {
      const next = { ...prev };
      // Toggle: if already pending the opposite, clear it; else flip
      const desiredDecision: PendingDecision = current === 'positive' ? 'bad' : 'good';
      if (next[id] != null) {
        delete next[id];
      } else {
        next[id] = desiredDecision;
      }
      return next;
    });
  };

  const handleSave = async () => {
    const decisions = Object.entries(pendingChanges).map(([id, decision]) => ({ id, decision }));
    if (decisions.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch('/api/activate/civil-photo-gallery/save-decisions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisions }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setPendingChanges({});
        void loadPhotos(activeStep);
      } else {
        log.error('Civil gallery save failed', { error: data.error?.message }, 'CivilsGalleryTab');
        setError(data.error?.message ?? 'Save failed. Please try again.');
      }
    } catch (err) {
      log.error('Civil gallery save error', { error: err instanceof Error ? err.message : String(err) }, 'CivilsGalleryTab');
      setError('Save failed. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const pendingCount = Object.keys(pendingChanges).length;

  return (
    <div className="flex h-[calc(100vh-73px)]">
      {/* Sidebar */}
      <div className="w-52 shrink-0 overflow-y-auto border-r border-neutral-800 bg-neutral-900 py-2">
        {CIVIL_STEPS.map(({ number, label }) => {
          const count = stepCounts[number] ?? 0;
          const isActive = activeStep === number;
          return (
            <button
              key={number}
              type="button"
              onClick={() => setActiveStep(number)}
              className={`w-full px-4 py-3 text-left transition-colors ${
                isActive
                  ? 'bg-blue-900/40 border-l-2 border-blue-500 text-white'
                  : 'text-neutral-400 hover:bg-neutral-800 hover:text-white border-l-2 border-transparent'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Step {number}
                </span>
                <span className={`text-xs rounded px-1.5 py-0.5 ${count > 0 ? 'bg-neutral-700 text-neutral-300' : 'text-neutral-600'}`}>
                  {count}
                </span>
              </div>
              <p className="mt-0.5 text-sm leading-tight">{label}</p>
            </button>
          );
        })}
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        {/* Step header */}
        <div className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-900/95 backdrop-blur px-6 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-white">
                Step {activeStep}: {CIVIL_STEP_LABELS[activeStep]}
              </h2>
              <p className="text-sm text-neutral-400">{photos.length} photos loaded</p>
            </div>
            {pendingCount > 0 && (
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save {pendingCount} change{pendingCount !== 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        ) : error ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-red-400">
            <AlertCircle className="h-8 w-8" />
            <span>{error}</span>
          </div>
        ) : (
          <CivilPhotoGrid
            photos={photos}
            pendingChanges={pendingChanges}
            onToggle={toggleLabel}
          />
        )}
      </div>
    </div>
  );
}
