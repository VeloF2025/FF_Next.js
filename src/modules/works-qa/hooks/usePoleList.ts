import useSWR from 'swr';
import type { PoleSummary } from '../types/works-qa.types';

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
}

const fetcher = async (url: string): Promise<PoleSummary[]> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const body = (await res.json()) as ApiEnvelope<PoleSummary[]> | PoleSummary[];
  if (Array.isArray(body)) return body;
  return body.data ?? [];
};

export function usePoleList(projectId: string | null, ponNo: number | null) {
  const params = new URLSearchParams();
  if (projectId) params.set('project_id', projectId);
  if (ponNo != null) params.set('pon_no', String(ponNo));

  const { data, error, mutate, isLoading } = useSWR<PoleSummary[]>(
    projectId ? `/api/works-qa/poles?${params}` : null,
    fetcher,
    { refreshInterval: 30_000 }
  );

  return { poles: data ?? [], error, isLoading, mutate };
}
