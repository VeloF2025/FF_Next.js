import useSWR from 'swr';
import type { PoleQaPhoto } from '../types/works-qa.types';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function usePoleDetail(poleId: string | null) {
  const { data, error, mutate, isLoading } = useSWR<PoleQaPhoto>(
    poleId ? `/api/works-qa/pole-detail?pole_id=${poleId}` : null,
    fetcher
  );

  return { pole: data ?? null, error, isLoading, mutate };
}
