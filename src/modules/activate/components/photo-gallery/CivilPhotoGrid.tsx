'use client';

import { CheckCircle, XCircle } from 'lucide-react';
import type { CivilGalleryPhoto } from '@/pages/api/activate/civil-photo-gallery/index';

type CivilLabel = 'positive' | 'negative';
type PendingDecision = 'good' | 'bad';

export interface CivilPhotoGridProps {
  photos: CivilGalleryPhoto[];
  pendingChanges: Record<string, PendingDecision>;
  onToggle: (id: string, current: CivilLabel) => void;
}

export function CivilPhotoGrid({ photos, pendingChanges, onToggle }: CivilPhotoGridProps) {
  if (photos.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-neutral-500">
        No photos available for this step
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-3 p-4 sm:grid-cols-4 lg:grid-cols-5">
      {photos.map((photo) => {
        const pending = pendingChanges[photo.id];
        const effectiveLabel: CivilLabel =
          pending != null
            ? pending === 'good'
              ? 'positive'
              : 'negative'
            : photo.label;
        const isPositive = effectiveLabel === 'positive';

        return (
          <button
            key={photo.id}
            type="button"
            onClick={() => onToggle(photo.id, effectiveLabel)}
            className={`relative overflow-hidden rounded-lg border-2 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              isPositive
                ? 'border-green-500'
                : 'border-red-500'
            }`}
          >
            <img
              src={photo.photoUrl}
              alt={`Step ${photo.stepNumber} photo`}
              className="aspect-square w-full object-cover"
            />
            <div
              className={`absolute bottom-0 left-0 right-0 flex items-center justify-center gap-1 py-1 text-xs font-semibold ${
                isPositive
                  ? 'bg-green-900/80 text-green-300'
                  : 'bg-red-900/80 text-red-300'
              }`}
            >
              {isPositive ? (
                <CheckCircle className="h-3 w-3" />
              ) : (
                <XCircle className="h-3 w-3" />
              )}
              {isPositive ? 'PASS' : 'FAIL'}
            </div>
            {pending != null && (
              <div className="absolute right-1 top-1 h-2 w-2 rounded-full bg-yellow-400" />
            )}
          </button>
        );
      })}
    </div>
  );
}
