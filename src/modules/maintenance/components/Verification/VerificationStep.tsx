/**
 * VerificationStep Component - Single verification step display
 *
 * 🟢 WORKING: Production-ready verification step component
 *
 * Features:
 * - Checkbox for step completion
 * - Step number and name display
 * - Photo upload integration
 * - Notes display
 * - Completion timestamp
 * - Category badge
 * - Disabled state support
 */

'use client';

import React, { useCallback } from 'react';
import { Check, Camera, Clock, User } from 'lucide-react';
import { PhotoUpload } from './PhotoUpload';
import { cn } from '@/lib/utils';
import type { VerificationStep as VerificationStepType, VerificationStepNumber } from '../../types/verification';
import { VERIFICATION_STEP_TEMPLATES, getStepCategoryColor } from '../../constants/verificationSteps';

interface VerificationStepProps {
  /** Verification step data */
  step: VerificationStepType;
  /** Callback when step completion is toggled */
  onToggle: (stepNumber: VerificationStepNumber, isComplete: boolean) => void;
  /** Callback when photo is uploaded */
  onPhotoUpload: (stepNumber: VerificationStepNumber, photoUrl: string) => void;
  /** Callback when photo is deleted */
  onPhotoDelete?: (stepNumber: VerificationStepNumber) => void;
  /** Whether step is editable */
  editable: boolean;
  /** Compact mode for smaller display */
  compact?: boolean;
}

/**
 * 🟢 WORKING: Individual verification step component
 */
export function VerificationStep({
  step,
  onToggle,
  onPhotoUpload,
  onPhotoDelete,
  editable,
  compact = false,
}: VerificationStepProps) {
  const template = VERIFICATION_STEP_TEMPLATES[step.step_number];

  // 🟢 WORKING: Handle checkbox toggle
  const handleToggle = useCallback(() => {
    if (editable) {
      onToggle(step.step_number, !step.is_complete);
    }
  }, [editable, onToggle, step.step_number, step.is_complete]);

  // 🟢 WORKING: Handle photo upload
  const handlePhotoUploaded = useCallback(
    (photoUrl: string) => {
      onPhotoUpload(step.step_number, photoUrl);
    },
    [onPhotoUpload, step.step_number]
  );

  // 🟢 WORKING: Handle photo delete
  const handlePhotoDeleted = useCallback(() => {
    if (onPhotoDelete) {
      onPhotoDelete(step.step_number);
    }
  }, [onPhotoDelete, step.step_number]);

  // Get category color
  const categoryColor = getStepCategoryColor(template.category);
  const categoryBgColor = {
    primary: 'bg-blue-500/20 text-blue-400',
    secondary: 'bg-purple-500/20 text-purple-400',
    success: 'bg-green-500/20 text-green-400',
    info: 'bg-cyan-500/20 text-cyan-400',
  }[categoryColor];

  return (
    <li
      className={cn(
        'group relative border border-[var(--ff-border-light)] rounded-lg transition-all hover:border-[var(--ff-border-light)]',
        step.is_complete ? 'bg-green-500/5' : 'bg-[var(--ff-bg-secondary)]',
        compact ? 'p-3' : 'p-4'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Step number and checkbox */}
        <div className="flex flex-col items-center gap-2">
          {/* Step number badge */}
          <div
            className={cn(
              'flex items-center justify-center rounded-full font-semibold',
              compact ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm',
              step.is_complete
                ? 'bg-green-500 text-[var(--ff-text-primary)]'
                : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]'
            )}
          >
            {step.is_complete ? <Check className="w-5 h-5" /> : step.step_number}
          </div>

          {/* Checkbox */}
          <input
            type="checkbox"
            checked={step.is_complete}
            onChange={handleToggle}
            disabled={!editable}
            className={cn(
              'w-5 h-5 rounded border-2 cursor-pointer transition-all',
              'checked:bg-green-500 checked:border-green-500',
              'focus:ring-2 focus:ring-green-500/50',
              !editable && 'cursor-not-allowed opacity-50'
            )}
            aria-label={`Mark step ${step.step_number} as ${step.is_complete ? 'incomplete' : 'complete'}`}
          />
        </div>

        {/* Step content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex-1">
              <h4
                className={cn(
                  'font-semibold',
                  compact ? 'text-sm' : 'text-base',
                  step.is_complete ? 'text-[var(--ff-text-primary)]' : 'text-[var(--ff-text-primary)]'
                )}
              >
                {step.step_name}
              </h4>
              {!compact && step.step_description && (
                <p className="text-sm text-[var(--ff-text-secondary)] mt-1">{step.step_description}</p>
              )}
            </div>

            {/* Category badge */}
            <span
              className={cn(
                'px-2 py-1 text-xs font-medium rounded-full whitespace-nowrap',
                categoryBgColor
              )}
            >
              {template.category}
            </span>
          </div>

          {/* Photo section */}
          {template.photo_required && (
            <div className="mt-3">
              <div className="flex items-center gap-2 mb-2">
                <Camera className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                <span className="text-xs font-medium text-[var(--ff-text-primary)]">Photo Required</span>
                {step.photo_verified && (
                  <span className="text-xs text-green-400 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Verified
                  </span>
                )}
              </div>

              <PhotoUpload
                photoUrl={step.photo_url}
                photoVerified={step.photo_verified}
                disabled={!editable}
                onPhotoUploaded={handlePhotoUploaded}
                onPhotoDeleted={handlePhotoDeleted}
                compact={compact}
              />
            </div>
          )}

          {/* Notes */}
          {step.notes && (
            <div className="mt-3 p-2 bg-[var(--ff-bg-secondary)] rounded border border-[var(--ff-border-light)]">
              <p className="text-xs text-[var(--ff-text-secondary)] italic">{step.notes}</p>
            </div>
          )}

          {/* Completion info */}
          {step.is_complete && step.completed_at && (
            <div className="mt-3 flex items-center gap-4 text-xs text-[var(--ff-text-secondary)]">
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>
                  {new Date(step.completed_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              {step.completed_by && (
                <div className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  <span>Completed by user</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}