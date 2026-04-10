/**
 * ReviewWizard — 5-Phase QA Wizard for Construction Reviews
 *
 * Phases:
 *   1. Prerequisites — verify photos exist, feature data loaded
 *   2. Photo Review — checklist walkthrough with VLM scores
 *   3. Data Validation — verify VLM-extracted data matches QField
 *   4. Final Decision — PASS / FAIL / REWORK_NEEDED
 *   5. Feedback — WhatsApp notification to technician
 *
 * Pattern: Follows Activate QA Centre wizard conventions
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Camera,
  ClipboardCheck,
  Database,
  Gavel,
  MessageSquare,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import { log } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';
import { getChecklist } from '../../types/construction.types';
import type {
  Discipline,
  WorkflowStatus,
  QaDecision,
  QaReasonCode,
  ChecklistStep,
} from '../../types';
import { PhasePrerequisites } from './PhasePrerequisites';
import { PhasePhotoReview } from './PhasePhotoReview';
import { PhaseDataValidation } from './PhaseDataValidation';
import { PhaseFinalDecision } from './PhaseFinalDecision';
import { PhaseFeedback } from './PhaseFeedback';

interface ReviewData {
  id: string;
  project_id: string;
  feature_id: string;
  feature_type: string;
  discipline: Discipline;
  project_name: string;
  zone_no: number | null;
  pon_no: number | null;
  photo_count: number;
  vlm_status: string;
  vlm_confidence: number | null;
  workflow_status: WorkflowStatus;
  qa_decision: QaDecision | null;
  qa_decision_at: string | null;
  qa_decision_by: string | null;
  qa_notes: string | null;
  qa_reason_code: string | null;
  wa_feedback_sent_at: string | null;
  wa_feedback_message: string | null;
  priority: string;
  assigned_to: string | null;
  [key: string]: unknown;
}

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
  [key: string]: unknown;
}

type Phase = 'prerequisites' | 'photo_review' | 'data_validation' | 'final_decision' | 'feedback';

const PHASES: { key: Phase; label: string; icon: typeof CheckCircle }[] = [
  { key: 'prerequisites', label: 'Prerequisites', icon: ClipboardCheck },
  { key: 'photo_review', label: 'Photo Review', icon: Camera },
  { key: 'final_decision', label: 'Decision', icon: Gavel },
  { key: 'data_validation', label: 'Data Validation', icon: Database },
  { key: 'feedback', label: 'Feedback', icon: MessageSquare },
];

interface ReviewWizardProps {
  reviewId: string;
}

export function ReviewWizard({ reviewId }: ReviewWizardProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('prerequisites');
  const [review, setReview] = useState<ReviewData | null>(null);
  const [photos, setPhotos] = useState<PhotoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Checklist state (discipline-specific)
  const [checkedSteps, setCheckedSteps] = useState<Record<string, boolean>>({});
  const [extractedOverrides, setExtractedOverrides] = useState<Record<string, string>>({});
  const [decision, setDecision] = useState<QaDecision | null>(null);
  const [reasonCodes, setReasonCodes] = useState<QaReasonCode[]>([]);
  const [notes, setNotes] = useState('');

  // Feature rename state
  const [isEditingFeatureId, setIsEditingFeatureId] = useState(false);
  const [editFeatureId, setEditFeatureId] = useState('');

  // Fetch review data
  const fetchReview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/construction-qa/review?id=${reviewId}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(res.status === 404 ? 'Review not found' : `Failed to load review (${res.status})`);
      const data = await res.json();

      const rv = data.data?.review;
      if (!rv) {
        setError('Review not found');
        return;
      }

      setReview(rv);
      setPhotos(data.data?.photos || []);

      // Initialize checked steps from review data
      const checklist = getChecklist(rv.discipline);
      const initial: Record<string, boolean> = {};
      for (const step of checklist) {
        const col = getStepColumn(rv.discipline, step.step);
        initial[col] = Boolean(rv[col]);
      }
      setCheckedSteps(initial);

      // Restore decision if already made
      if (rv.qa_decision) {
        setDecision(rv.qa_decision);
        setNotes(rv.qa_notes || '');
      }

      // If already decided, jump to feedback phase
      if (rv.workflow_status === 'approved' || rv.workflow_status === 'rejected' || rv.workflow_status === 'rework_needed') {
        setPhase('feedback');
      }
    } catch (err) {
      setError((err as Error).message);
      log.error('Failed to load review', { module: 'construction-qa', error: (err as Error).message }, 'construction-qa');
    } finally {
      setLoading(false);
    }
  }, [reviewId]);

  useEffect(() => { fetchReview(); }, [fetchReview]);

  // Save a single step toggle immediately (fire-and-forget)
  const saveStepToggle = async (col: string, val: boolean) => {
    if (!review) return;
    try {
      await fetch('/api/construction-qa/review', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewId: review.id,
          stepUpdates: { [col]: val },
          reviewedBy: 'current_user',
        }),
      });
    } catch (err) {
      log.error('Failed to save step toggle', { module: 'construction-qa', error: (err as Error).message }, 'construction-qa');
    }
  };

  // Save checklist progress
  const saveProgress = async () => {
    if (!review) return;
    setSaving(true);
    try {
      await fetch('/api/construction-qa/review', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewId: review.id,
          stepUpdates: checkedSteps,
          extractedDataUpdates: extractedOverrides,
          notes,
          reviewedBy: 'current_user', // TODO: get from auth context
        }),
      });
    } catch (err) {
      log.error('Failed to save progress', { module: 'construction-qa', error: (err as Error).message }, 'construction-qa');
    } finally {
      setSaving(false);
    }
  };

  // Submit final decision
  const submitDecision = async () => {
    if (!review || !decision) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/construction-qa/final-decision', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewId: review.id,
          decision,
          reasonCodes,
          notes,
          sendFeedback: decision !== 'PASS',
          decidedBy: 'current_user',
        }),
      });

      if (res.ok) {
        await fetchReview();
        setPhase('feedback');
      } else {
        const body = await res.json().catch(() => null);
        const msg = body?.error?.message || body?.message || `Decision failed (${res.status})`;
        setError(msg);
        log.error('Decision API error', { module: 'construction-qa', status: res.status, msg }, 'construction-qa');
      }
    } catch (err) {
      log.error('Failed to submit decision', { module: 'construction-qa', error: (err as Error).message }, 'construction-qa');
      setError('Network error — could not submit decision');
    } finally {
      setSaving(false);
    }
  };

  // Save feature ID rename
  const saveFeatureId = async () => {
    if (!review || !editFeatureId.trim() || editFeatureId.trim() === review.feature_id) {
      setIsEditingFeatureId(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/construction-qa/review', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewId: review.id,
          featureIdUpdate: editFeatureId.trim(),
          reviewedBy: 'current_user',
        }),
      });
      if (res.ok) {
        await fetchReview();
        setIsEditingFeatureId(false);
      }
    } catch (err) {
      log.error('Failed to update feature ID', { module: 'construction-qa', error: (err as Error).message }, 'construction-qa');
    } finally {
      setSaving(false);
    }
  };

  // Drag-and-drop photo step reassignment
  const handlePhotoStepChange = async (photoId: string, newStep: number | null, stepLabel: string | null) => {
    if (!review) return;

    // Find the photo's current step before moving
    const movedPhoto = photos.find(p => p.id === photoId);
    const oldStep = movedPhoto?.checklist_step ?? null;

    // Optimistic photo update
    const updatedPhotos = photos.map(p =>
      p.id === photoId ? { ...p, checklist_step: newStep, step_label: stepLabel } : p
    );
    setPhotos(updatedPhotos);

    // Auto-sync checkboxes: tick destination, untick empty source
    if (newStep != null && newStep > 0) {
      const destCol = getStepColumn(review.discipline, newStep);
      if (!checkedSteps[destCol]) {
        setCheckedSteps(prev => ({ ...prev, [destCol]: true }));
        saveStepToggle(destCol, true);
      }
    }
    if (oldStep != null && oldStep > 0) {
      const sourceStillHasPhotos = updatedPhotos.some(
        p => p.id !== photoId && p.checklist_step === oldStep
      );
      if (!sourceStillHasPhotos) {
        const srcCol = getStepColumn(review.discipline, oldStep);
        if (checkedSteps[srcCol]) {
          setCheckedSteps(prev => ({ ...prev, [srcCol]: false }));
          saveStepToggle(srcCol, false);
        }
      }
    }

    try {
      const res = await fetch('/api/construction-qa/photo-step', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId, step: newStep, stepLabel }),
      });
      if (!res.ok) {
        log.error('Failed to update photo step', { module: 'construction-qa', photoId, newStep });
        await fetchReview(); // Revert on failure
      }
    } catch (err) {
      log.error('Photo step change error', { module: 'construction-qa', error: (err as Error).message });
      await fetchReview(); // Revert on failure
    }
  };

  const goNext = async () => {
    const idx = PHASES.findIndex(p => p.key === phase);
    if (idx < PHASES.length - 1) {
      await saveProgress();

      setPhase(PHASES[idx + 1]!.key);
    }
  };

  const goPrev = () => {
    const idx = PHASES.findIndex(p => p.key === phase);
    if (idx > 0) setPhase(PHASES[idx - 1]!.key);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingSpinner size="lg" label="" />
      </div>
    );
  }

  if (error || !review) {
    return (
      <div className="text-center py-24">
        <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Review Not Found</h2>
        <p className="text-gray-400 mb-6">{error || 'This review does not exist.'}</p>
        <button
          onClick={() => router.push('/field-ops')}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Back to QA Centre
        </button>
      </div>
    );
  }

  const checklist = getChecklist(review.discipline);
  const phaseIdx = PHASES.findIndex(p => p.key === phase);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => {
            const params = new URLSearchParams();
            if (review.zone_no !== null) params.set('zone', String(review.zone_no));
            if (review.pon_no !== null) params.set('pon', String(review.pon_no));
            const qs = params.toString();
            router.push(`/field-ops/project/${review.project_id}${qs ? `?${qs}` : ''}`);
          }}
          className="p-2 hover:bg-[var(--hover-bg)] rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-400" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {isEditingFeatureId ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editFeatureId}
                  onChange={e => setEditFeatureId(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveFeatureId();
                    if (e.key === 'Escape') setIsEditingFeatureId(false);
                  }}
                  className="px-2 py-1 bg-gray-800 border border-blue-500 rounded text-white text-lg font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  autoFocus
                />
                <Button variant="ghost" size="icon" onClick={saveFeatureId} disabled={saving} title="Save">
                  <Check className="w-5 h-5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setIsEditingFeatureId(false)} title="Cancel">
                  <X className="w-5 h-5" />
                </Button>
              </div>
            ) : (
              <>
                <h1 className="text-xl font-bold text-white">{review.feature_id}</h1>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { setEditFeatureId(review.feature_id); setIsEditingFeatureId(true); }}
                  title="Rename or reassign to another pole"
                >
                  <Pencil className="w-4 h-4" />
                </Button>
              </>
            )}
          </div>
          <p className="text-sm text-gray-400">
            {review.project_name} · {review.discipline} ·{' '}
            {review.zone_no !== null ? `Z${review.zone_no}` : ''}{' '}
            {review.pon_no !== null ? `P${review.pon_no}` : ''}
            {(() => {
              // Pole Plant Date = Step 7 (After Photo) date, fall back to last_photo_at
              const step7Photo = photos.find(p => p.checklist_step === 7 && (p as Record<string, unknown>).captured_at);
              const plantedAt = (step7Photo as Record<string, unknown>)?.captured_at as string
                || review.last_photo_at as string;
              return plantedAt ? (
                <> · Planted {new Date(plantedAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}</>
              ) : null;
            })()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
            review.workflow_status === 'approved' ? 'bg-green-500/20 text-green-400' :
            review.workflow_status === 'rejected' ? 'bg-red-500/20 text-red-400' :
            review.workflow_status === 'rework_needed' ? 'bg-orange-500/20 text-orange-400' :
            'bg-yellow-500/20 text-yellow-400'
          }`}>
            {review.workflow_status.replace('_', ' ')}
          </span>
          <span className="text-sm text-gray-500">{photos.length} photos</span>
        </div>
      </div>

      {/* Phase Progress Bar */}
      <div className="flex items-center gap-1 bg-[var(--card-bg)] p-2 rounded-lg border border-[var(--border-color)]">
        {PHASES.map((p, i) => {
          const Icon = p.icon;
          const isActive = p.key === phase;
          const isDone = i < phaseIdx;
          return (
            <button
              key={p.key}
              onClick={() => setPhase(p.key)}
              className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : isDone
                    ? 'bg-green-600/20 text-green-400'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-[var(--hover-bg)]'
              }`}
            >
              {isDone ? <CheckCircle className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
              <span className="hidden md:inline">{p.label}</span>
            </button>
          );
        })}
      </div>

      {/* Inline error banner (dismissible) */}
      {error && review && (
        <div className="flex items-center gap-3 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <Button variant="ghost" size="icon" onClick={() => setError(null)} aria-label="Dismiss error">
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Phase Content */}
      <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg p-6 min-h-[400px]">
        {phase === 'prerequisites' && (
          <PhasePrerequisites
            review={review}
            photos={photos}
            checklist={checklist}
          />
        )}
        {phase === 'photo_review' && (
          <PhasePhotoReview
            review={review}
            photos={photos}
            checklist={checklist}
            checkedSteps={checkedSteps}
            onStepChange={(col, val) => {
              setCheckedSteps(prev => ({ ...prev, [col]: val }));
              saveStepToggle(col, val);
            }}
            onPhotoStepChange={handlePhotoStepChange}
          />
        )}
        {phase === 'data_validation' && (
          <PhaseDataValidation
            review={review}
            overrides={extractedOverrides}
            onOverride={(field, val) => setExtractedOverrides(prev => ({ ...prev, [field]: val }))}
          />
        )}
        {phase === 'final_decision' && (
          <PhaseFinalDecision
            review={review}
            checklist={checklist}
            checkedSteps={checkedSteps}
            decision={decision}
            reasonCodes={reasonCodes}
            notes={notes}
            onDecisionChange={setDecision}
            onReasonCodesChange={setReasonCodes}
            onNotesChange={setNotes}
          />
        )}
        {phase === 'feedback' && (
          <PhaseFeedback review={review} />
        )}
      </div>

      {/* Navigation Buttons — pr-20 clears the Velo chatbot FAB */}
      <div className="flex items-center justify-between pr-20">
        <button
          onClick={goPrev}
          disabled={phaseIdx === 0}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-sm text-gray-300 hover:bg-[var(--hover-bg)] disabled:opacity-50"
        >
          <ArrowLeft className="w-4 h-4" />
          Previous
        </button>

        <div className="flex items-center gap-3">
          {saving && <InlineSpinner size="sm" />}

          {phase === 'final_decision' && decision ? (
            <button
              onClick={submitDecision}
              disabled={saving}
              className={`flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-medium text-white ${
                decision === 'PASS' ? 'bg-green-600 hover:bg-green-700' :
                decision === 'FAIL' ? 'bg-red-600 hover:bg-red-700' :
                'bg-orange-600 hover:bg-orange-700'
              } disabled:opacity-50`}
            >
              <Gavel className="w-4 h-4" />
              Submit {decision}
            </button>
          ) : phase !== 'feedback' ? (
            <button
              onClick={goNext}
              disabled={saving || phaseIdx >= PHASES.length - 1}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              Next
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Get the database column name for a discipline step */
function getStepColumn(discipline: Discipline, step: number): string {
  const pad = String(step).padStart(2, '0');
  const stepNames: Record<string, Record<number, string>> = {
    civil: {
      1: 'before_photo', 2: 'during_photo', 3: 'depth_photo', 4: 'end_plates',
      5: 'compaction', 6: 'level_check', 7: 'after_photo',
    },
    optical: {
      // Phase A (dome, steps 1-8)
      1: 'dome_on_pole', 2: 'dome_label', 3: 'open_dome', 4: 'splice_protectors',
      5: 'slack_management', 6: 'strength_members', 7: 'seals_dustcaps', 8: 'pole_id',
      // Phase B (main joint, steps 11-16)
      11: 'cable_entries', 12: 'strength_members', 13: 'tube_routing',
      14: 'tray_entries', 15: 'coiling_protectors', 16: 'readable_labels',
    },
  };
  return `${discipline}_step_${pad}_${stepNames[discipline]?.[step] || 'unknown'}`;
}
