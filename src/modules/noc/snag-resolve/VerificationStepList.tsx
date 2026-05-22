/**
 * Verification steps + photo-slot tile grid for the public snag/resolve page.
 *
 * Renders the maintenance_verification_steps list with progress bar. For each
 * step:
 *   - If photo_slots are pre-seeded (slot-aware step), shows a grid of slot
 *     tiles each with its own upload control.
 *   - Otherwise (legacy single-photo step), shows a single Upload Photo /
 *     Mark Complete button row.
 *
 * Once a step is complete its evidence is treated as immutable on this
 * public endpoint — matches the server-side lock in shared/[token].ts.
 */

import { CheckCircle, Circle, Camera, Clock, Upload } from 'lucide-react';
import { TicketStatus } from '@/modules/noc/types/ticket';
import type { SlotPhoto, VerificationStep } from './types';

interface VerificationStepListProps {
  steps: VerificationStep[];
  canInteract: boolean;
  ticketStatus: TicketStatus;
  uploadingStep: string | null;
  actionLoading: boolean;
  hasActor: boolean;
  onUpload: (stepId: string, file: File, slotKey?: string) => void;
  onMarkComplete: (stepId: string) => void;
  onIdentityRequired: () => void;
}

export function VerificationStepList({
  steps,
  canInteract,
  ticketStatus,
  uploadingStep,
  actionLoading,
  hasActor,
  onUpload,
  onMarkComplete,
  onIdentityRequired,
}: VerificationStepListProps) {
  if (steps.length === 0) return null;

  const completedSteps = steps.filter((s) => s.is_complete).length;
  const progressPct = Math.round((completedSteps / steps.length) * 100);

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-zinc-200">Verification Steps</h3>
        <span className="text-xs text-zinc-400">
          {completedSteps}/{steps.length} completed ({progressPct}%)
        </span>
      </div>

      <div className="h-2 bg-zinc-800 rounded-full mb-4 overflow-hidden">
        <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
      </div>

      <div className="space-y-3">
        {steps.map((step) => (
          <StepRow
            key={step.id}
            step={step}
            canInteract={canInteract}
            ticketStatus={ticketStatus}
            uploadingStep={uploadingStep}
            actionLoading={actionLoading}
            hasActor={hasActor}
            onUpload={onUpload}
            onMarkComplete={onMarkComplete}
            onIdentityRequired={onIdentityRequired}
          />
        ))}
      </div>
    </div>
  );
}

interface StepRowProps {
  step: VerificationStep;
  canInteract: boolean;
  ticketStatus: TicketStatus;
  uploadingStep: string | null;
  actionLoading: boolean;
  hasActor: boolean;
  onUpload: (stepId: string, file: File, slotKey?: string) => void;
  onMarkComplete: (stepId: string) => void;
  onIdentityRequired: () => void;
}

function StepRow({
  step,
  canInteract,
  ticketStatus,
  uploadingStep,
  actionLoading,
  hasActor,
  onUpload,
  onMarkComplete,
  onIdentityRequired,
}: StepRowProps) {
  const showLegacyControls =
    step.photo_slots.length === 0 && canInteract && ticketStatus === TicketStatus.IN_PROGRESS && !step.is_complete;

  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
        step.is_complete ? 'bg-green-900/10 border-green-700/30' : 'bg-zinc-800/50 border-zinc-700'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          {step.is_complete ? (
            <CheckCircle className="w-5 h-5 text-green-400" />
          ) : (
            <Circle className="w-5 h-5 text-zinc-500" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-zinc-200">
              {step.step_number}. {step.step_name}
            </span>
            {step.photo_required && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-300 border border-orange-700/30">
                Photo Required
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-400 mb-2">{step.step_description}</p>

          {step.photo_slots.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
              {step.photo_slots.map((slot) => (
                <PhotoSlotTile
                  key={slot.slot_key}
                  stepId={step.id}
                  slot={slot}
                  canUpload={canInteract && ticketStatus === TicketStatus.IN_PROGRESS && !step.is_complete}
                  uploadingStep={uploadingStep}
                  onUpload={onUpload}
                />
              ))}
            </div>
          )}

          {showLegacyControls && (
            <div className="flex items-center gap-2 mt-2">
              {step.photo_required ? (
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-xs font-medium rounded cursor-pointer transition-colors">
                  <Camera className="w-3.5 h-3.5" />
                  {uploadingStep === step.id ? 'Uploading...' : 'Upload Photo'}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onUpload(step.id, file);
                    }}
                    disabled={uploadingStep === step.id}
                  />
                </label>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (!hasActor) {
                      onIdentityRequired();
                      return;
                    }
                    onMarkComplete(step.id);
                  }}
                  disabled={actionLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 text-xs font-medium rounded transition-colors"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  Mark Complete
                </button>
              )}
            </div>
          )}

          {step.is_complete && step.completed_at && (
            <p className="text-[10px] text-green-400/70 mt-1 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Completed {new Date(step.completed_at).toLocaleDateString('en-ZA')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface PhotoSlotTileProps {
  stepId: string;
  slot: SlotPhoto;
  canUpload: boolean;
  uploadingStep: string | null;
  onUpload: (stepId: string, file: File, slotKey?: string) => void;
}

function PhotoSlotTile({ stepId, slot, canUpload, uploadingStep, onUpload }: PhotoSlotTileProps) {
  const isUploading = uploadingStep === `${stepId}:${slot.slot_key}`;
  const captureAttr = slot.source_mode === 'camera' ? 'environment' : undefined;

  return (
    <div
      className={`rounded border p-2 text-[11px] ${
        slot.photo_url
          ? 'bg-green-900/10 border-green-700/30'
          : slot.is_required
          ? 'bg-zinc-900/40 border-zinc-700'
          : 'bg-zinc-900/20 border-zinc-800'
      }`}
    >
      <div className="flex items-center gap-1 mb-1">
        <span className="font-medium text-zinc-200 truncate">{slot.slot_label}</span>
        {slot.is_required && !slot.photo_url && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-orange-900/40 text-orange-300">Required</span>
        )}
      </div>
      {slot.photo_url ? (
        <a href={slot.photo_url} target="_blank" rel="noopener noreferrer" className="block">
          <img src={slot.photo_url} alt={slot.slot_label} className="w-full h-20 object-cover rounded" />
        </a>
      ) : (
        <div className="w-full h-20 rounded bg-zinc-800/60 flex items-center justify-center text-zinc-500">
          <Camera className="w-4 h-4" />
        </div>
      )}
      {canUpload && (
        <label className="inline-flex items-center gap-1 mt-1.5 px-2 py-1 bg-blue-700 hover:bg-blue-600 text-white text-[10px] font-medium rounded cursor-pointer transition-colors w-full justify-center">
          <Upload className="w-3 h-3" />
          {isUploading
            ? 'Uploading...'
            : slot.photo_url
            ? 'Replace'
            : slot.source_mode === 'gallery'
            ? 'Upload'
            : 'Take photo'}
          <input
            type="file"
            accept="image/*"
            {...(captureAttr ? { capture: captureAttr } : {})}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(stepId, file, slot.slot_key);
            }}
            disabled={isUploading}
          />
        </label>
      )}
    </div>
  );
}
