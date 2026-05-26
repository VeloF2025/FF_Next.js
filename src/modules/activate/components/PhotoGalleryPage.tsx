'use client';

/**
 * Photo Gallery — Criteria Review
 *
 * Shows accepted photos (from PASS DRs) grouped by step.
 * QA manager reviews each photo and marks it as a GOOD example.
 * Marked photos become few-shot criteria examples for the PhotoGuide PWA VLM.
 *
 * URL: /activate/photo-gallery
 */

import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, XCircle, ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { log } from '@/lib/logger';

const STEP_LABELS: Record<number, string> = {
  1: 'House Photo',
  2: 'Cable from Pole',
  3: 'Entry Outside',
  4: 'Entry Inside',
  5: 'Wall (ONT Mount)',
  6: 'ONT Back After Install',
  7: 'Power Meter',
  8: 'Final Installation',
  9: 'Green Lights',
  10: 'Signature',
};

interface GalleryPhoto {
  drNumber: string;
  filename: string;
  url: string;
  confidence: number;
  originalType: string | null;
}

interface StepCount {
  step: number;
  photo_count: string;
}

type PhotoDecision = 'good' | 'bad' | null;

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

  // Load step counts on mount
  useEffect(() => {
    fetch('/api/activate/photo-gallery?all=true', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.data?.counts) {
          const counts: Record<number, number> = {};
          (data.data.counts as StepCount[]).forEach((c) => {
            counts[c.step] = parseInt(String(c.photo_count), 10);
          });
          setStepCounts(counts);
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

  const toggleDecision = (photoKey: string, decision: PhotoDecision) => {
    setDecisions((prev) => ({
      ...prev,
      [photoKey]: prev[photoKey] === decision ? null : decision,
    }));
  };

  const photoKey = (p: GalleryPhoto) => `${p.drNumber}__${p.filename}`;

  const goodCount = photos.filter((p) => decisions[photoKey(p)] === 'good').length;
  const badCount = photos.filter((p) => decisions[photoKey(p)] === 'bad').length;
  const undecidedCount = photos.length - goodCount - badCount;

  const goodPhotos = photos.filter((p) => decisions[photoKey(p)] === 'good');
  const badPhotos = photos.filter((p) => decisions[photoKey(p)] === 'bad');

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
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-white">Photo Criteria Review Gallery</h1>
            <p className="mt-0.5 text-sm text-gray-400">
              Review accepted photos per step. Mark ✅ GOOD to flag as a training example, ❌ BAD to flag as
              problematic.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* View toggle */}
            <div className="flex rounded-lg border border-gray-700 overflow-hidden text-sm">
              <button
                onClick={() => setViewMode('grid')}
                className={`px-3 py-1.5 ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
              >
                Grid
              </button>
              <button
                onClick={() => setViewMode('single')}
                className={`px-3 py-1.5 ${viewMode === 'single' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
              >
                Single
              </button>
            </div>
            {/* Copy results */}
            {(goodCount > 0 || badCount > 0) && (
              <button
                onClick={copyResults}
                className="rounded-lg bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-600"
              >
                Copy Results ({goodCount}✅ {badCount}❌)
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex h-[calc(100vh-73px)]">
        {/* Step sidebar */}
        <div className="w-52 shrink-0 overflow-y-auto border-r border-gray-800 bg-gray-900 py-2">
          {Object.entries(STEP_LABELS).map(([stepStr, label]) => {
            const step = parseInt(stepStr, 10);
            const count = stepCounts[step] ?? 0;
            const isActive = activeStep === step;
            return (
              <button
                key={step}
                onClick={() => setActiveStep(step)}
                className={`w-full px-4 py-3 text-left transition-colors ${
                  isActive
                    ? 'bg-blue-900/40 border-l-2 border-blue-500 text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white border-l-2 border-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Step {step}
                  </span>
                  <span
                    className={`text-xs rounded px-1.5 py-0.5 ${count > 0 ? 'bg-gray-700 text-gray-300' : 'text-gray-600'}`}
                  >
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
                      {badCount > 0 && (
                        <span> · <span className="text-red-400">{badCount} bad</span></span>
                      )}
                      {undecidedCount > 0 && (
                        <span> · {undecidedCount} undecided</span>
                      )}
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
            /* Grid view */
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {photos.map((photo, idx) => {
                const key = photoKey(photo);
                const decision = decisions[key];
                const hasError = imageErrors[key];
                return (
                  <div
                    key={key}
                    className={`group relative overflow-hidden rounded-lg border-2 transition-all cursor-pointer ${
                      decision === 'good'
                        ? 'border-green-500 ring-1 ring-green-500/30'
                        : decision === 'bad'
                        ? 'border-red-500 ring-1 ring-red-500/30'
                        : 'border-gray-700 hover:border-gray-500'
                    }`}
                    onClick={() => {
                      setCurrentIndex(idx);
                      setViewMode('single');
                    }}
                  >
                    {hasError ? (
                      <div className="flex h-32 items-center justify-center bg-gray-800 text-gray-600 text-xs">
                        No image
                      </div>
                    ) : (
                      <img
                        src={photo.url}
                        alt={`${photo.drNumber} step ${activeStep}`}
                        className="h-32 w-full object-cover"
                        loading="lazy"
                        onError={() => setImageErrors((prev) => ({ ...prev, [key]: true }))}
                      />
                    )}

                    {/* Decision badge */}
                    {decision && (
                      <div
                        className={`absolute top-1 right-1 rounded-full p-0.5 ${
                          decision === 'good' ? 'bg-green-500' : 'bg-red-500'
                        }`}
                      >
                        {decision === 'good' ? (
                          <CheckCircle2 className="h-4 w-4 text-white" />
                        ) : (
                          <XCircle className="h-4 w-4 text-white" />
                        )}
                      </div>
                    )}

                    {/* Confidence badge */}
                    <div className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-xs text-gray-300">
                      {(photo.confidence * 100).toFixed(0)}%
                    </div>

                    {/* Hover action buttons */}
                    <div className="absolute inset-x-0 bottom-0 flex translate-y-full gap-1 bg-black/80 p-1.5 transition-transform group-hover:translate-y-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleDecision(key, 'good');
                        }}
                        className={`flex flex-1 items-center justify-center gap-1 rounded py-1 text-xs font-medium transition-colors ${
                          decision === 'good'
                            ? 'bg-green-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-green-700 hover:text-white'
                        }`}
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Good
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleDecision(key, 'bad');
                        }}
                        className={`flex flex-1 items-center justify-center gap-1 rounded py-1 text-xs font-medium transition-colors ${
                          decision === 'bad'
                            ? 'bg-red-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-red-700 hover:text-white'
                        }`}
                      >
                        <XCircle className="h-3 w-3" />
                        Bad
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Single photo view */
            <div className="flex flex-col items-center p-6">
              {photos[currentIndex] && (() => {
                const photo = photos[currentIndex]!;
                const key = photoKey(photo);
                const decision = decisions[key];
                const hasError = imageErrors[key];
                return (
                  <div className="w-full max-w-2xl">
                    {/* Navigation */}
                    <div className="mb-3 flex items-center justify-between text-sm text-gray-400">
                      <button
                        onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                        disabled={currentIndex === 0}
                        className="flex items-center gap-1 rounded px-2 py-1 hover:bg-gray-800 disabled:opacity-30"
                      >
                        <ChevronLeft className="h-4 w-4" /> Prev
                      </button>
                      <span>
                        {currentIndex + 1} / {photos.length}
                      </span>
                      <button
                        onClick={() => setCurrentIndex((i) => Math.min(photos.length - 1, i + 1))}
                        disabled={currentIndex === photos.length - 1}
                        className="flex items-center gap-1 rounded px-2 py-1 hover:bg-gray-800 disabled:opacity-30"
                      >
                        Next <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Photo */}
                    <div
                      className={`overflow-hidden rounded-xl border-4 ${
                        decision === 'good'
                          ? 'border-green-500'
                          : decision === 'bad'
                          ? 'border-red-500'
                          : 'border-gray-700'
                      }`}
                    >
                      {hasError ? (
                        <div className="flex h-80 items-center justify-center bg-gray-800 text-gray-500">
                          Image could not be loaded
                        </div>
                      ) : (
                        <img
                          src={photo.url}
                          alt={`${photo.drNumber} step ${activeStep}`}
                          className="max-h-[60vh] w-full object-contain bg-gray-900"
                          onError={() => setImageErrors((prev) => ({ ...prev, [key]: true }))}
                        />
                      )}
                    </div>

                    {/* Meta */}
                    <div className="mt-2 text-center text-sm text-gray-400">
                      {photo.drNumber} · {photo.filename}
                      {photo.originalType && <span> · type: {photo.originalType}</span>}
                      · confidence: {(photo.confidence * 100).toFixed(0)}%
                    </div>

                    {/* Action buttons */}
                    <div className="mt-4 flex gap-3">
                      <button
                        onClick={() => toggleDecision(key, 'good')}
                        className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-base font-semibold transition-all ${
                          decision === 'good'
                            ? 'bg-green-600 text-white ring-2 ring-green-400'
                            : 'bg-gray-800 text-gray-300 hover:bg-green-800 hover:text-white'
                        }`}
                      >
                        <CheckCircle2 className="h-5 w-5" />
                        Good example
                      </button>
                      <button
                        onClick={() => {
                          toggleDecision(key, null);
                        }}
                        className="rounded-xl bg-gray-800 px-4 text-sm text-gray-400 hover:bg-gray-700 hover:text-white"
                      >
                        Skip
                      </button>
                      <button
                        onClick={() => toggleDecision(key, 'bad')}
                        className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-base font-semibold transition-all ${
                          decision === 'bad'
                            ? 'bg-red-600 text-white ring-2 ring-red-400'
                            : 'bg-gray-800 text-gray-300 hover:bg-red-800 hover:text-white'
                        }`}
                      >
                        <XCircle className="h-5 w-5" />
                        Bad example
                      </button>
                    </div>

                    {/* Auto-advance to next after decision */}
                    {decision && currentIndex < photos.length - 1 && (
                      <button
                        onClick={() => setCurrentIndex((i) => i + 1)}
                        className="mt-2 w-full rounded-lg bg-gray-800 py-2 text-sm text-gray-400 hover:bg-gray-700"
                      >
                        Next photo →
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
