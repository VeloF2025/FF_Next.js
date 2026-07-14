/**
 * useSiteCamPhotos
 *
 * Fetches the SiteCam /my PWA wizard submission for a DR and exposes it as
 * gallery-ready data (Photo[] grouped later by step). Reuses the existing
 * GET /api/sitecam/submission/:drNumber endpoint, which reads
 * dr_photo_unified_reviews.pwa_photo_urls.
 *
 * Kept in a hook module (not the component file) so the component file only
 * exports components — required for React Fast Refresh
 * (react-refresh/only-export-components).
 */

import { useEffect, useState } from 'react';
import type { Photo } from '../types/unified.types';
import { log } from '@/lib/logger';

export interface SiteCamData {
  photos: Photo[];
  count: number;
  submittedAt: string | null;
  techName: string | null;
  loading: boolean;
  error: string | null;
}

interface SubmissionResponse {
  success: boolean;
  data?: {
    submission: {
      submittedAt: string;
      techName: string;
      photoCount: number;
      photoUrls: Record<number, string>;
    } | null;
  };
}

const EMPTY: SiteCamData = {
  photos: [],
  count: 0,
  submittedAt: null,
  techName: null,
  loading: false,
  error: null,
};

/** Map the pwa_photo_urls step→url map into the Photo[] shape PhotoGalleryUnified expects. */
function toPhotos(photoUrls: Record<number, string>): Photo[] {
  return Object.entries(photoUrls)
    .map(([step, url]) => ({
      filename: url.split('/').pop() || `sitecam-step-${step}.jpg`,
      step: Number(step),
      url,
    }))
    .sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
}

export function useSiteCamPhotos(drNumber: string): SiteCamData {
  const [data, setData] = useState<SiteCamData>({ ...EMPTY, loading: true });

  useEffect(() => {
    let cancelled = false;
    setData({ ...EMPTY, loading: true });

    fetch(`/api/sitecam/submission/${drNumber}`, { credentials: 'include' })
      .then((r) => r.json() as Promise<SubmissionResponse>)
      .then((d) => {
        if (cancelled) return;
        const submission = d.success ? d.data?.submission ?? null : null;
        if (!submission) {
          setData(EMPTY);
          return;
        }
        const photos = toPhotos(submission.photoUrls ?? {});
        setData({
          photos,
          count: submission.photoCount ?? photos.length,
          submittedAt: submission.submittedAt ?? null,
          techName: submission.techName ?? null,
          loading: false,
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        log.warn('Failed to load SiteCam photos', { drNumber, error: String(err) }, 'useSiteCamPhotos');
        setData({ ...EMPTY, error: 'Failed to load SiteCam photos' });
      });

    return () => {
      cancelled = true;
    };
  }, [drNumber]);

  return data;
}
