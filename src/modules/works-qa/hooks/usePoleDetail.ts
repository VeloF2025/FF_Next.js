import useSWR from 'swr';
import type { PoleQaPhoto } from '../types/works-qa.types';

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
}

const fetcher = async (url: string): Promise<PoleQaPhoto> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const body = (await res.json()) as ApiEnvelope<PoleQaPhoto> | PoleQaPhoto;
  if ('data' in body && body.data !== undefined) return body.data;
  return body as PoleQaPhoto;
};

export function usePoleDetail(poleId: string | null) {
  const { data, error, mutate, isLoading } = useSWR<PoleQaPhoto>(
    poleId ? `/api/works-qa/pole-detail?pole_id=${poleId}` : null,
    fetcher
  );

  return { pole: data ?? null, error, isLoading, mutate };
}
