import { CheckCircle2, XCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { GalleryPhoto, PhotoDecision, photoKey } from './types';

interface PhotoSingleViewProps {
  photos: GalleryPhoto[];
  currentIndex: number;
  decisions: Record<string, PhotoDecision>;
  imageErrors: Record<string, boolean>;
  activeStep: number;
  onSetIndex: (idx: number) => void;
  onToggleDecision: (key: string, decision: PhotoDecision) => void;
  onImageError: (key: string) => void;
}

/** Full-size single-photo reviewer with prev/next navigation and Good/Bad/Skip. */
export function PhotoSingleView({
  photos,
  currentIndex,
  decisions,
  imageErrors,
  activeStep,
  onSetIndex,
  onToggleDecision,
  onImageError,
}: PhotoSingleViewProps) {
  const photo = photos[currentIndex];
  if (!photo) return null;

  const key = photoKey(photo);
  const decision = decisions[key];
  const hasError = imageErrors[key];

  return (
    <div className="flex flex-col items-center p-6">
      <div className="w-full max-w-2xl">
        {/* Navigation */}
        <div className="mb-3 flex items-center justify-between text-sm text-gray-400">
          <button
            onClick={() => onSetIndex(Math.max(0, currentIndex - 1))}
            disabled={currentIndex === 0}
            className="flex items-center gap-1 rounded px-2 py-1 hover:bg-gray-800 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" /> Prev
          </button>
          <span>
            {currentIndex + 1} / {photos.length}
          </span>
          <button
            onClick={() => onSetIndex(Math.min(photos.length - 1, currentIndex + 1))}
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
              onError={() => onImageError(key)}
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
            onClick={() => onToggleDecision(key, 'good')}
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
            onClick={() => onToggleDecision(key, null)}
            className="rounded-xl bg-gray-800 px-4 text-sm text-gray-400 hover:bg-gray-700 hover:text-white"
          >
            Skip
          </button>
          <button
            onClick={() => onToggleDecision(key, 'bad')}
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
            onClick={() => onSetIndex(currentIndex + 1)}
            className="mt-2 w-full rounded-lg bg-gray-800 py-2 text-sm text-gray-400 hover:bg-gray-700"
          >
            Next photo →
          </button>
        )}
      </div>
    </div>
  );
}
