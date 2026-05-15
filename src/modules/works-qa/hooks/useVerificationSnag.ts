import useSWR from 'swr';
import type { Snag } from '@/modules/construction-qa/types/snag.types';

interface ApiEnvelope<T> { success?: boolean; data?: T }

async function fetcher(url: string): Promise<Snag | null> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const body = (await res.json()) as ApiEnvelope<Snag[]> | Snag[];
  const list = Array.isArray(body) ? body : body.data ?? [];
  // Prefer open over verified for display purposes
  const open = list.find(s => s.status === 'open');
  if (open) return open;
  return list[0] ?? null;
}

/**
 * Returns the most relevant verification snag for the given pole, if any.
 * Filters server-side on `pole_qa_photo_id` so multi-pole projects can't show
 * a sibling pole's snag by accident. `null` while loading or when none exists.
 */
export function useVerificationSnag(projectId: string | null, poleQaPhotoId: string | null) {
  const key = projectId && poleQaPhotoId
    ? `/api/snags?projectId=${encodeURIComponent(projectId)}&category=verification&pole_qa_photo_id=${encodeURIComponent(poleQaPhotoId)}`
    : null;
  const { data, isLoading, mutate } = useSWR<Snag | null>(key, fetcher);
  return { snag: data ?? null, isLoading, mutate };
}
