import useSWR from 'swr';

export interface AssignableUser {
  user_id: string;
  name: string;
  email: string | null;
  role: string;
}

interface Envelope { data?: { users?: AssignableUser[] } }

const fetcher = async (url: string): Promise<AssignableUser[]> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const body = (await res.json()) as Envelope;
  return body.data?.users ?? [];
};

export function useAssignableUsers(projectId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<AssignableUser[]>(
    projectId ? `/api/works-qa/assignable-users?project_id=${projectId}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );
  return { users: data ?? [], error, isLoading, mutate };
}
