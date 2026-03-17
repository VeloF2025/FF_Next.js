/**
 * PhotoCard - Individual photo review card for Auto-QA feedback
 *
 * Displays photo thumbnail with click-to-enlarge, step reassignment dropdown,
 * tier badge, confidence, decision toggle, and editable comments.
 * Step changes are recorded as HITL corrections for VLM learning.
 */

import { useState } from 'react';
import { STEP_LABELS } from '../../utils/stepMapper';
import type { AutoQaPhotoResult } from '../../services/autoQaCommentGenerator';

export interface EditablePhoto extends AutoQaPhotoResult {
  edited: boolean;
  /** Original VLM-predicted step before any human override */
  originalStep?: number;
}

interface PhotoCardProps {
  photo: EditablePhoto;
  dropNumber: string;
  onToggleDecision: () => void;
  onUpdateComment: (comment: string) => void;
  onChangeStep?: (newStep: number) => void;
  onClickPhoto?: () => void;
}

export function PhotoCard({
  photo,
  dropNumber,
  onToggleDecision,
  onUpdateComment,
  onChangeStep,
  onClickPhoto,
}: PhotoCardProps) {
  const [showComment, setShowComment] = useState(false);
  const photoUrl = `/api/activate/photo/${dropNumber}/${photo.filename}`;
  const isPassed = photo.decision === 'PASS';

  return (
    <div className={`rounded-lg border p-3 ${
      photo.edited
        ? 'border-yellow-400 dark:border-yellow-600 bg-yellow-50/50 dark:bg-yellow-900/10'
        : isPassed
        ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10'
        : 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10'
    }`}>
      <div className="flex gap-4">
        {/* Photo Thumbnail — click to enlarge */}
        <div className="flex-shrink-0">
          <button
            type="button"
            onClick={onClickPhoto}
            className="group relative cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-lg"
            title="Click to enlarge"
          >
            <img
              src={photoUrl}
              alt={photo.stepLabel}
              className="w-24 h-24 object-cover rounded-lg border border-border group-hover:border-blue-400 transition-colors"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-lg transition-colors flex items-center justify-center">
              <span className="text-white opacity-0 group-hover:opacity-100 text-lg transition-opacity">🔍</span>
            </div>
          </button>
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Step dropdown for reassignment */}
              {onChangeStep ? (
                <select
                  value={photo.step}
                  onChange={(e) => onChangeStep(parseInt(e.target.value, 10))}
                  className={`text-sm font-medium border rounded px-2 py-0.5 ${
                    photo.step === 0
                      ? 'border-orange-400 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300'
                      : 'border-border bg-card text-foreground'
                  }`}
                  title="Change photo step assignment"
                >
                  <option value="0">Discard (Step 0)</option>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((step) => (
                    <option key={step} value={step}>
                      {STEP_LABELS[step]}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="font-medium text-sm text-foreground">
                  {STEP_LABELS[photo.step] || photo.stepLabel}
                </span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                photo.tier === 'auto_approved'
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                  : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
              }`}>
                {photo.tier === 'auto_approved' ? 'AI Auto' : 'AI Review'}
              </span>
              <span className="text-xs text-muted-foreground">
                {Math.round(photo.confidence * 100)}%
              </span>
              {photo.edited && (
                <span className="text-xs px-1.5 py-0.5 bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200 rounded">
                  Edited
                </span>
              )}
            </div>

            {/* Toggle Button */}
            <button
              onClick={onToggleDecision}
              className={`px-3 py-1 text-sm font-medium rounded-lg border transition-colors ${
                isPassed
                  ? 'bg-green-600 text-white border-green-600 hover:bg-green-700'
                  : 'bg-red-600 text-white border-red-600 hover:bg-red-700'
              }`}
            >
              {isPassed ? 'PASS' : 'FAIL'}
            </button>
          </div>

          {/* Comment */}
          <p className="text-sm text-muted-foreground mb-1">{photo.comment}</p>

          {/* Edit Comment Toggle */}
          <button
            onClick={() => setShowComment(!showComment)}
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            {showComment ? 'Hide editor' : 'Edit comment'}
          </button>

          {showComment && (
            <input
              type="text"
              value={photo.comment}
              onChange={(e) => onUpdateComment(e.target.value)}
              className="mt-2 w-full px-2 py-1 text-sm border border-gray-200 dark:border-gray-600 rounded dark:bg-gray-900"
            />
          )}
        </div>
      </div>
    </div>
  );
}
