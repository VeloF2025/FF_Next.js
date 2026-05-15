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
 * `null` while loading or when none exists.
 */
export function useVerificationSnag(projectId: string | null, poleLabel: string | null) {
  const key = projectId && poleLabel
    ? `/api/snags?projectId=${encodeURIComponent(projectId)}&category=verification&search=${encodeURIComponent(poleLabel)}`
    : null;
  const { data, isLoading, mutate } = useSWR<Snag | null>(key, fetcher);
  return { snag: data ?? null, isLoading, mutate };
}
