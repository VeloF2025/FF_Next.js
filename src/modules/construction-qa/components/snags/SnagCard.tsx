/**
 * SnagCard — Compact snag card for the grid view.
 * Shows thumbnail, category badge, severity, status, and photo progress.
 */

'use client';

import { ImageIcon, RotateCcw } from 'lucide-react';
import type { Snag, SnagPhoto } from '../../types/snag.types';

interface SnagCardProps {
  snag: Snag;
  photos: SnagPhoto[];
  isExpanded: boolean;
  onClick: () => void;
}

const CATEGORY_BADGE: Record<string, string> = {
  quality:     'bg-blue-900/60 text-blue-300',
  safety:      'bg-red-900/60 text-red-300',
  health:      'bg-green-900/60 text-green-300',
  environment: 'bg-teal-900/60 text-teal-300',
  traffic:     'bg-orange-900/60 text-orange-300',
};

const SEVERITY_BORDER: Record<string, string> = {
  critical: 'border-l-4 border-l-red-500',
  major:    'border-l-4 border-l-orange-500',
  minor:    'border-l-4 border-l-zinc-500',
};

const STATUS_PILL: Record<string, string> = {
  open:        'bg-red-900/60 text-red-300',
  assigned:    'bg-orange-900/60 text-orange-300',
  in_progress: 'bg-yellow-900/60 text-yellow-300',
  fixed:       'bg-blue-900/60 text-blue-300',
  verified:    'bg-green-900/60 text-green-300',
  closed:      'bg-zinc-700 text-zinc-400',
  reopened:    'bg-red-900/80 text-red-200',
  wont_fix:    'bg-zinc-700 text-zinc-400',
  duplicate:   'bg-zinc-700 text-zinc-400',
};

const STATUS_CARD_BG: Record<string, string> = {
  open:        'bg-zinc-900',
  assigned:    'bg-zinc-900',
  in_progress: 'bg-zinc-900',
  fixed:       'bg-zinc-900',
  verified:    'bg-zinc-900',
  closed:      'bg-zinc-950 opacity-70',
  reopened:    'bg-zinc-900',
  wont_fix:    'bg-zinc-950 opacity-70',
  duplicate:   'bg-zinc-950 opacity-70',
};

function PhotoDot({ filled }: { filled: boolean }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${
        filled ? 'bg-green-500' : 'bg-zinc-600'
      }`}
    />
  );
}

/** 🟢 WORKING: Individual snag card */
export function SnagCard({ snag, photos, isExpanded, onClick }: SnagCardProps) {
  const beforePhoto = photos.find((p) => p.phase === 'before');
  const hasDuring   = photos.some((p) => p.phase === 'during');
  const hasAfter    = photos.some((p) => p.phase === 'after');

  const badgeClass    = CATEGORY_BADGE[snag.category]   ?? 'bg-zinc-700 text-zinc-300';
  const borderClass   = SEVERITY_BORDER[snag.severity]  ?? 'border-l-4 border-l-zinc-500';
  const statusClass   = STATUS_PILL[snag.status]        ?? 'bg-zinc-700 text-zinc-300';
  const bgClass       = STATUS_CARD_BG[snag.status]     ?? 'bg-zinc-900';

  // Use snag-level pole references first; fall back to the first photo that has one
  const poleRef =
    (snag.pole_references?.length ?? 0) > 0
      ? (snag.pole_references?.join(', ') ?? '—')
      : (photos.find((p) => p.pole_reference)?.pole_reference ?? '—');

  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        w-full text-left rounded-lg overflow-hidden cursor-pointer
        ${bgClass} ${borderClass}
        ${isExpanded ? 'ring-2 ring-blue-500' : 'hover:ring-1 hover:ring-zinc-600'}
        transition-all
      `}
    >
      {/* Thumbnail */}
      <div className="relative h-28 bg-zinc-800 overflow-hidden">
        {beforePhoto ? (
          <img
            src={beforePhoto.photo_url}
            alt={`Snag #${snag.snag_number} before`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-600">
            <ImageIcon className="h-8 w-8" />
          </div>
        )}

        {/* Repeat badge */}
        {snag.is_repeat && (
          <span className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-red-900/90 text-red-300 text-xs px-1.5 py-0.5 rounded font-medium">
            <RotateCcw className="h-3 w-3" />
            {snag.repeat_count > 0 ? `x${snag.repeat_count}` : 'Repeat'}
          </span>
        )}
      </div>

      {/* Card body */}
      <div className="p-2.5 space-y-1.5">
        {/* Header row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-semibold text-zinc-300">#{snag.snag_number}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded capitalize font-medium ${badgeClass}`}>
            {snag.category}
          </span>
        </div>

        {/* Description (1 line truncated) */}
        <p className="text-xs text-zinc-300 truncate leading-tight">{snag.description}</p>

        {/* Pole ref */}
        <p className="text-xs text-zinc-500 truncate">{poleRef}</p>

        {/* Bottom row: status + photo dots */}
        <div className="flex items-center justify-between">
          <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${statusClass}`}>
            {snag.status.replace('_', ' ')}
          </span>
          <div className="flex items-center gap-1">
            <PhotoDot filled={!!beforePhoto} />
            <PhotoDot filled={hasDuring} />
            <PhotoDot filled={hasAfter} />
          </div>
        </div>
      </div>
    </button>
  );
}
