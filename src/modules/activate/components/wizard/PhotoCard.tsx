/**
 * PhotoCard - Individual photo review card for Auto-QA feedback
 *
 * Displays photo thumbnail, tier, confidence, and decision toggle.
 * Extracted from AutoQaFeedbackPhase for file-size compliance.
 */

import { useState } from 'react';
import { STEP_LABELS } from '../../utils/stepMapper';
import type { AutoQaPhotoResult } from '../../services/autoQaCommentGenerator';

export interface EditablePhoto extends AutoQaPhotoResult {
  edited: boolean;
}

interface PhotoCardProps {
  photo: EditablePhoto;
  dropNumber: string;
  onToggleDecision: () => void;
  onUpdateComment: (comment: string) => void;
}

export function PhotoCard({
  photo,
  dropNumber,
  onToggleDecision,
  onUpdateComment,
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
        {/* Photo Thumbnail */}
        <div className="flex-shrink-0">
          <img
            src={photoUrl}
            alt={photo.stepLabel}
            className="w-24 h-24 object-cover rounded-lg border border-border"
            loading="lazy"
          />
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm text-foreground">
                {STEP_LABELS[photo.step] || photo.stepLabel}
              </span>
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
