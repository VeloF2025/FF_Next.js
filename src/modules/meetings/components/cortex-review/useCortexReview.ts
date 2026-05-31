/**
 * react-query data hooks for the Cortex Meeting Reviewer panel.
 *
 * - useCortexReviewQuery: fetches panel state, gated by `enabled` so it never
 *   round-trips Cortex when the panel is hidden (wrong tab / no view permission).
 * - useCortexReviewMutation: posts approve/reject/edit/publish/unpublish and
 *   invalidates the query on success (replaces hand-rolled busy/error flags).
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PanelData, MutationPayload } from './types';

function reviewKey(meetingId: string) {
  return ['cortex-meeting-review', meetingId] as const;
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return body.error?.message ?? `Request failed (${res.status})`;
}

export function useCortexReviewQuery(meetingId: string, enabled: boolean) {
  return useQuery<PanelData>({
    queryKey: reviewKey(meetingId),
    queryFn: async () => {
      const res = await fetch(`/api/cortex/meeting-review/${meetingId}`);
      if (!res.ok) throw new Error(await readError(res));
      const json = (await res.json()) as { data: PanelData };
      return json.data;
    },
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useCortexReviewMutation(meetingId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, MutationPayload>({
    mutationFn: async (payload: MutationPayload) => {
      const res = await fetch(`/api/cortex/meeting-review/${meetingId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await readError(res));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: reviewKey(meetingId) });
    },
  });
}
