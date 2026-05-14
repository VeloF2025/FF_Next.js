import useSWR from 'swr';

export interface PoleSnag {
  id: string;
  pole_qa_photo_id: string;
  slot_key: string;
  slot_photo_key: string | null;
  discipline: 'civil' | 'dome' | 'main_joint';
  description: string;
  severity: 'minor' | 'major' | 'critical';
  status: string;
  noc_ticket_id: string | null;
  ticket_uid: string | null;
  assigned_to: string | null;
  assignee_name: string | null;
  pole_label: string;
  created_at: string;
}

interface Envelope { data?: { snags?: PoleSnag[] } }

const fetcher = async (url: string): Promise<PoleSnag[]> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const body = (await res.json()) as Envelope;
  return body.data?.snags ?? [];
};

export function usePoleSnags(poleId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<PoleSnag[]>(
    poleId ? `/api/works-qa/photo-snags?pole_id=${poleId}` : null,
    fetcher
  );
  return { snags: data ?? [], error, isLoading, mutate };
}
