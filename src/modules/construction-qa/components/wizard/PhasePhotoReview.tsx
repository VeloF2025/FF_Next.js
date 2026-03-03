/**
 * Phase 2: Photo Review
 * Walk through each checklist step, view assigned photos, toggle checked state.
 * Click any photo to open full-screen lightbox with zoom.
 */

'use client';

import { useState, useMemo } from 'react';
import { CheckCircle, ChevronDown, ChevronRight, Image, AlertTriangle, Maximize2 } from 'lucide-react';
import type { ChecklistStep, Discipline } from '../../types';
import { PhotoLightbox } from './PhotoLightbox';

interface PhotoData {
  id: string;
  storage_key: string;
  source: string;
  filename: string | null;
  checklist_step: number | null;
  vlm_valid: boolean | null;
  vlm_confidence: number | null;
  vlm_issues: string[];
  vlm_feedback: string | null;
  manual_status: string | null;
  needs_retake: boolean;
}

interface Props {
  review: { discipline: Discipline; [key: string]: unknown };
  photos: PhotoData[];
  checklist: readonly ChecklistStep[];
  checkedSteps: Record<string, boolean>;
  onStepChange: (col: string, val: boolean) => void;
}

export function PhasePhotoReview({ review, photos, checklist, checkedSteps, onStepChange }: Props) {
  const [expandedStep, setExpandedStep] = useState<number | null>(1);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Group photos by step (step 0 = VLM-classified "unrelated" — treat as unassigned)
  const photosByStep = new Map<number, PhotoData[]>();
  const unassigned: PhotoData[] = [];
  for (const photo of photos) {
    if (photo.checklist_step != null && photo.checklist_step > 0) {
      if (!photosByStep.has(photo.checklist_step)) photosByStep.set(photo.checklist_step, []);
      photosByStep.get(photo.checklist_step)!.push(photo);
    } else {
      unassigned.push(photo);
    }
  }

  // Flat list of all photos for lightbox navigation (step photos first, then unassigned)
  const allPhotos = useMemo(() => {
    const ordered: PhotoData[] = [];
    for (const step of checklist) {
      const stepPhotos = photosByStep.get(step.step) || [];
      ordered.push(...stepPhotos);
    }
    ordered.push(...unassigned);
    return ordered;
  }, [photos, checklist]);

  const openLightbox = (photoId: string) => {
    const idx = allPhotos.findIndex(p => p.id === photoId);
    if (idx >= 0) setLightboxIndex(idx);
  };

  const getStepColumn = (step: number): string => {
    const pad = String(step).padStart(2, '0');
    const stepNames: Record<string, Record<number, string>> = {
      civil: { 1: 'before_photo', 2: 'during_photo', 3: 'depth_photo', 4: 'end_plates', 5: 'compaction', 6: 'level_check', 7: 'after_photo', 8: 'signature' },
      optical: { 1: 'cable_route', 2: 'attachment', 3: 'slack_coil', 4: 'cable_label', 5: 'no_backfeed', 6: 'sag_ok' },
      splicing: { 1: 'dome_on_pole', 2: 'dome_label', 3: 'open_dome', 4: 'splice_protectors', 5: 'slack_management', 6: 'strength_members', 7: 'seals_dustcaps', 8: 'pole_id', 11: 'cable_entries', 12: 'strength_members', 13: 'tube_routing', 14: 'tray_entries', 15: 'coiling_protectors', 16: 'readable_labels' },
    };
    return `${review.discipline}_step_${pad}_${stepNames[review.discipline]?.[step] || 'unknown'}`;
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white mb-1">Photo Review</h2>
        <p className="text-sm text-gray-400">
          Review each checklist step and verify photos meet quality standards. Click any photo to enlarge.
        </p>
      </div>

      {/* Checklist Steps */}
      <div className="space-y-2">
        {checklist.map(step => {
          const stepPhotos = photosByStep.get(step.step) || [];
          const col = getStepColumn(step.step);
          const isChecked = checkedSteps[col] || false;
          const isExpanded = expandedStep === step.step;
          const avgConfidence = stepPhotos.length > 0
            ? stepPhotos.reduce((sum, p) => sum + (p.vlm_confidence || 0), 0) / stepPhotos.length
            : null;

          return (
            <div
              key={step.step}
              className={`border rounded-lg overflow-hidden ${
                isChecked ? 'border-green-500/30' : 'border-[var(--border-color)]'
              }`}
            >
              {/* Step Header */}
              <div
                onClick={() => setExpandedStep(isExpanded ? null : step.step)}
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--hover-bg)] transition-colors"
              >
                {/* Checkbox */}
                <button
                  onClick={e => { e.stopPropagation(); onStepChange(col, !isChecked); }}
                  className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                    isChecked
                      ? 'bg-green-600 border-green-600'
                      : 'border-gray-600 hover:border-gray-400'
                  }`}
                >
                  {isChecked && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                </button>

                {/* Step Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">
                      Step {step.step}: {step.label}
                    </span>
                    {!step.required && (
                      <span className="text-xs text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">optional</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{step.vlmCheck}</p>
                </div>

                {/* Photo count + VLM score */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    <Image className="w-3 h-3" />
                    {stepPhotos.length}
                  </div>
                  {avgConfidence !== null && (
                    <span className={`text-xs font-mono ${
                      avgConfidence >= 0.8 ? 'text-green-400' :
                      avgConfidence >= 0.6 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {Math.round(avgConfidence * 100)}%
                    </span>
                  )}
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                </div>
              </div>

              {/* Expanded: Photo Grid */}
              {isExpanded && (
                <div className="px-4 pb-4 border-t border-[var(--border-color)]">
                  {step.notes && (
                    <p className="text-xs text-gray-500 py-2 italic">{step.notes}</p>
                  )}

                  {stepPhotos.length === 0 ? (
                    <div className="text-center py-6 text-gray-500 text-sm">
                      No photos assigned to this step
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 pt-3">
                      {stepPhotos.map(photo => (
                        <div
                          key={photo.id}
                          onClick={() => openLightbox(photo.id)}
                          className="relative rounded-lg overflow-hidden border cursor-pointer transition-all hover:border-blue-500 hover:ring-2 hover:ring-blue-500/30 border-[var(--border-color)] group"
                        >
                          {/* Photo thumbnail */}
                          <div className="aspect-square bg-gray-900 flex items-center justify-center">
                            <img
                              src={`/api/construction-qa/photo-proxy?key=${encodeURIComponent(photo.storage_key)}&source=${photo.source}`}
                              alt={photo.filename || 'Photo'}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          </div>

                          {/* Enlarge indicator on hover */}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                            <Maximize2 className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>

                          {/* VLM badge */}
                          {photo.vlm_confidence != null && (
                            <div className={`absolute top-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                              photo.vlm_confidence >= 0.8 ? 'bg-green-600/90 text-white' :
                              photo.vlm_confidence >= 0.6 ? 'bg-yellow-600/90 text-white' :
                              'bg-red-600/90 text-white'
                            }`}>
                              {Math.round(photo.vlm_confidence * 100)}%
                            </div>
                          )}

                          {/* Retake warning */}
                          {photo.needs_retake && (
                            <div className="absolute top-1 left-1">
                              <AlertTriangle className="w-4 h-4 text-orange-400" />
                            </div>
                          )}

                          {/* Filename at bottom */}
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1">
                            <div className="text-[10px] text-gray-300 truncate">{photo.filename}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Unassigned Photos */}
      {unassigned.length > 0 && (
        <div className="border border-yellow-500/30 rounded-lg p-4">
          <h3 className="text-sm font-medium text-yellow-400 mb-2">
            Unassigned Photos ({unassigned.length})
          </h3>
          <p className="text-xs text-gray-500 mb-3">
            These photos are not linked to any checklist step yet. Click to enlarge.
          </p>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {unassigned.map(photo => (
              <div
                key={photo.id}
                onClick={() => openLightbox(photo.id)}
                className="aspect-square bg-gray-900 rounded overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500/30 transition-all group relative"
              >
                <img
                  src={`/api/construction-qa/photo-proxy?key=${encodeURIComponent(photo.storage_key)}&source=${photo.source}`}
                  alt={photo.filename || 'Photo'}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                  <Maximize2 className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={allPhotos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
