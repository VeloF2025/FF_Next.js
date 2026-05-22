import { useState } from 'react';
import { log } from '@/lib/logger';

export interface AutoSortSummary {
  auto_placed: number;
  suggested: number;
  leftover: number;
}

interface UseAutoSortArgs {
  poleId: string;
  onSorted: () => void | Promise<void>;
}

interface UseAutoSortApi {
  running: boolean;
  summary: AutoSortSummary | null;
  error: string | null;
  sort: () => Promise<void>;
}

/**
 * Wraps POST /api/works-qa/auto-sort. The handler iterates the pole's
 * unassigned bucket through the VLM classifier and writes auto-placements
 * or suggestion JSON back to the row. After completion, calls onSorted()
 * so the SWR cache for the pole refreshes and the bucket re-renders with
 * badges / fewer photos.
 */
export function useAutoSort({ poleId, onSorted }: UseAutoSortArgs): UseAutoSortApi {
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<AutoSortSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sort() {
    if (running) return;
    setRunning(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch('/api/works-qa/auto-sort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pole_id: poleId }),
      });
      const json = (await res.json().catch(() => null)) as
        | { success: true; data: AutoSortSummary }
        | { success: false; error?: { message?: string } }
        | null;
      if (!res.ok || !json || !('success' in json) || !json.success) {
        const detail = json && 'error' in json ? json.error?.message : res.statusText;
        setError(detail ?? `HTTP ${res.status}`);
        log.error('works-qa: auto-sort failed', { poleId, detail });
        return;
      }
      setSummary({
        auto_placed: json.data.auto_placed,
        suggested: json.data.suggested,
        leftover: json.data.leftover,
      });
      await onSorted();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      log.error('works-qa: auto-sort threw', { error: msg, poleId });
    } finally {
      setRunning(false);
    }
  }

  return { running, summary, error, sort };
}
