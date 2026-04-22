/**
 * HistoricalPhotosPanel — renders the Historical Photos tab on a NOC ticket.
 *
 * Pulls from /api/noc/tickets/{id}/historical-photos which aggregates every
 * photo source tied to the ticket's DR and/or pole. Each source is rendered
 * as its own section so NOC agents can scan them independently.
 */

'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Image as ImageIcon } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PhotoLightbox } from '@/components/PhotoLightbox';
import type { LightboxPhoto } from '@/components/PhotoLightbox';
import { log } from '@/lib/logger';

interface HistoricalPhoto {
  url: string;
  thumbnailUrl?: string;
  label: string;
  metadata?: string;
  capturedAt?: string | null;
  stepNumber?: number | null;
}

interface HistoricalPhotoGroup {
  key: string;
  label: string;
  entity: 'dr' | 'pole';
  entityId: string;
  count: number;
  photos: HistoricalPhoto[];
  error?: string;
}

interface HistoricalPhotosPayload {
  drNumber: string | null;
  poleNumber: string | null;
  groups: HistoricalPhotoGroup[];
}

interface Props {
  ticketId: string;
  /** Optional callback so parent tab can show a count badge. */
  onCountChange?: (total: number) => void;
}

export function HistoricalPhotosPanel({ ticketId, onCountChange }: Props) {
  const [payload, setPayload] = useState<HistoricalPhotosPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ photos: LightboxPhoto[]; index: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetch(`/api/noc/tickets/${ticketId}/historical-photos`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        if (!json.success) throw new Error(json.error?.message ?? 'Failed to load historical photos');
        const data: HistoricalPhotosPayload = json.data;
        setPayload(data);
        const total = data.groups.reduce((sum, g) => sum + g.count, 0);
        onCountChange?.(total);
      })
      .catch((err) => {
        if (cancelled) return;
        log.error('Failed to load historical photos', { ticketId, err });
        setError(err instanceof Error ? err.message : 'Failed to load historical photos');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ticketId, onCountChange]);

  if (isLoading) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-8">
        <LoadingSpinner size="md" label="Loading historical photos..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-red-400 mb-1">Could not load historical photos</h3>
            <p className="text-sm text-red-300">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!payload) return null;

  if (!payload.drNumber && !payload.poleNumber) {
    return (
      <EmptyState
        title="No DR or pole linked to this ticket"
        message="Historical photos are only available for tickets tied to a drop (DR) or a pole."
      />
    );
  }

  const totalPhotos = payload.groups.reduce((sum, g) => sum + g.count, 0);
  const errorGroups = payload.groups.filter((g) => g.error);
  if (totalPhotos === 0 && errorGroups.length === 0) {
    const entity = payload.drNumber
      ? `DR ${payload.drNumber}`
      : `pole ${payload.poleNumber}`;
    return (
      <EmptyState
        title="No historical photos found"
        message={`Nothing has been captured for ${entity} yet.`}
      />
    );
  }

  return (
    <>
      <div className="space-y-6">
        <Header drNumber={payload.drNumber} poleNumber={payload.poleNumber} totalPhotos={totalPhotos} />

        {payload.groups.map((group) => (
          <GroupSection
            key={group.key}
            group={group}
            onPhotoClick={(index) => {
              const lightboxPhotos: LightboxPhoto[] = group.photos.map((p) => ({
                url: p.url,
                label: p.label,
                metadata: p.metadata,
              }));
              setLightbox({ photos: lightboxPhotos, index });
            }}
          />
        ))}
      </div>

      {lightbox && (
        <PhotoLightbox
          photos={lightbox.photos}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}

function Header({
  drNumber,
  poleNumber,
  totalPhotos,
}: {
  drNumber: string | null;
  poleNumber: string | null;
  totalPhotos: number;
}) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4 flex items-center gap-3">
      <ImageIcon className="w-5 h-5 text-blue-400" />
      <div className="flex-1 min-w-0">
        <h3 className="text-base font-semibold text-[var(--ff-text-primary)]">Historical Photos</h3>
        <p className="text-xs text-[var(--ff-text-secondary)]">
          {totalPhotos} photo{totalPhotos === 1 ? '' : 's'} across{' '}
          {[
            drNumber ? `DR ${drNumber}` : null,
            poleNumber ? `pole ${poleNumber}` : null,
          ]
            .filter(Boolean)
            .join(' and ')}
        </p>
      </div>
    </div>
  );
}

function GroupSection({
  group,
  onPhotoClick,
}: {
  group: HistoricalPhotoGroup;
  onPhotoClick: (index: number) => void;
}) {
  if (group.error) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-[var(--ff-text-primary)]">{group.label}</h4>
          <span className="text-xs text-[var(--ff-text-secondary)]">{group.entity === 'dr' ? 'DR' : 'Pole'} {group.entityId}</span>
        </div>
        <div className="flex items-start gap-2 text-sm text-amber-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>Could not load: {group.error}</span>
        </div>
      </div>
    );
  }

  if (group.count === 0) {
    return null;
  }

  return (
    <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4 sm:p-6">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-[var(--ff-text-primary)]">
          {group.label} <span className="text-[var(--ff-text-secondary)] font-normal">· {group.count} photo{group.count === 1 ? '' : 's'}</span>
        </h4>
        <span className="text-xs text-[var(--ff-text-secondary)]">{group.entity === 'dr' ? 'DR' : 'Pole'} {group.entityId}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {group.photos.map((photo, index) => (
          <button
            key={`${group.key}-${index}`}
            type="button"
            onClick={() => onPhotoClick(index)}
            className="block overflow-hidden rounded-lg border border-[var(--ff-border-light)] hover:border-blue-500/60 transition-colors text-left"
          >
            <img
              src={photo.thumbnailUrl ?? photo.url}
              alt={photo.label}
              className="w-full h-32 object-cover bg-[var(--ff-bg-tertiary)]"
              loading="lazy"
            />
            <div className="px-2 py-1.5 bg-[var(--ff-bg-tertiary)]">
              <div className="text-xs text-[var(--ff-text-primary)] truncate">{photo.label}</div>
              {photo.metadata && (
                <div className="text-[10px] text-[var(--ff-text-secondary)] truncate">{photo.metadata}</div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-8 text-center">
      <ImageIcon className="w-10 h-10 text-[var(--ff-text-secondary)] mx-auto mb-3" />
      <h3 className="text-base font-semibold text-[var(--ff-text-primary)] mb-1">{title}</h3>
      <p className="text-sm text-[var(--ff-text-secondary)]">{message}</p>
    </div>
  );
}
