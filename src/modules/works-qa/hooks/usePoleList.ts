import useSWR from 'swr';
import type { PoleSummary } from '../types/works-qa.types';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

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
