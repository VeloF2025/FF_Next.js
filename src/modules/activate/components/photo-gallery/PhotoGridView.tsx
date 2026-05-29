import { CheckCircle2, MinusCircle, XCircle } from 'lucide-react';
import { GalleryPhoto, PhotoDecision, photoKey } from './types';

interface PhotoGridViewProps {
  photos: GalleryPhoto[];
  decisions: Record<string, PhotoDecision>;
  imageErrors: Record<string, boolean>;
  activeStep: number;
  onOpenSingle: (idx: number) => void;
  onToggleDecision: (key: string, decision: PhotoDecision) => void;
  onImageError: (key: string) => void;
}

/** Thumbnail grid; clicking a tile opens the single view, hover reveals Good/Bad. */
export function PhotoGridView({
  photos,
  decisions,
  imageErrors,
  activeStep,
  onOpenSingle,
  onToggleDecision,
  onImageError,
}: PhotoGridViewProps) {
  return (
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
            onClick={() => onOpenSingle(idx)}
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
                onError={() => onImageError(key)}
              />
            )}

            {/* Always-visible PASS / FAIL / Unreviewed banner */}
            <div
              className={`absolute inset-x-0 top-0 flex items-center justify-center gap-1 py-0.5 text-[11px] font-semibold ${
                decision === 'good'
                  ? 'bg-green-600/90 text-white'
                  : decision === 'bad'
                  ? 'bg-red-600/90 text-white'
                  : 'bg-black/60 text-gray-500'
              }`}
            >
              {decision === 'good' ? (
                <><CheckCircle2 className="h-3 w-3" /> PASS</>
              ) : decision === 'bad' ? (
                <><XCircle className="h-3 w-3" /> FAIL</>
              ) : (
                <><MinusCircle className="h-3 w-3" /> Unreviewed</>
              )}
            </div>

            {/* Confidence badge */}
            <div className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-xs text-gray-300">
              {(photo.confidence * 100).toFixed(0)}%
            </div>

            {/* Hover action buttons */}
            <div className="absolute inset-x-0 bottom-0 flex translate-y-full gap-1 bg-black/80 p-1.5 transition-transform group-hover:translate-y-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleDecision(key, 'good');
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
                  onToggleDecision(key, 'bad');
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
  );
}
