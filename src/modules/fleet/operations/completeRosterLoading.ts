import { loadOperationalEvidence, type OperationalEvidenceRequest } from './evidenceQueries';
import { getOperationalRosterStatus, type RosterStatusRequest, type RosterStatusResult } from './statusService';
import type { OperationalEvidence } from './types';

/**
 * The operations overview and the map overlay both need every scheduled
 * staff member for a project/day, not just the first page. The underlying
 * statusService/evidenceQueries readers cap a single call at 100 rows (PR4's
 * contract) and report `hasMore`/`total`, so this pages through those calls
 * until each source reports it is complete. A named upper bound guards
 * against a runaway loop; a selection that genuinely exceeds it fails loudly
 * with a specific, actionable error instead of truncating data or crashing.
 */
export const MAX_COMPLETE_ROSTER_ROWS = 2000;
const PAGE_SIZE = 100;

export class OperationalRosterTooLargeError extends Error {
  constructor(limit: number) {
    super(`This operational selection has more than ${limit} scheduled staff; narrow the project or date range and try again`);
    this.name = 'OperationalRosterTooLargeError';
  }
}

export async function loadCompleteOperationalRoster(
  request: Omit<RosterStatusRequest, 'page' | 'limit'>,
): Promise<RosterStatusResult> {
  const first = await getOperationalRosterStatus({ ...request, page: 1, limit: PAGE_SIZE });
  const items = [...first.items];
  let latest = first;
  let page = 1;
  while (latest.hasMore) {
    if (items.length >= MAX_COMPLETE_ROSTER_ROWS) throw new OperationalRosterTooLargeError(MAX_COMPLETE_ROSTER_ROWS);
    page += 1;
    latest = await getOperationalRosterStatus({ ...request, page, limit: PAGE_SIZE });
    items.push(...latest.items);
  }
  return { items, page: first.page, limit: first.limit, total: latest.total, hasMore: false };
}

export type CompleteOperationalEvidenceRequest = Omit<OperationalEvidenceRequest, 'limit' | 'offset'>;
export interface CompleteOperationalEvidencePage { items: OperationalEvidence[]; total: number }

export async function loadCompleteOperationalEvidence(
  request: CompleteOperationalEvidenceRequest,
): Promise<CompleteOperationalEvidencePage> {
  const items: OperationalEvidence[] = [];
  let offset = 0;
  for (;;) {
    const page = await loadOperationalEvidence({ ...request, limit: PAGE_SIZE, offset });
    items.push(...page.items);
    if (items.length >= page.total || page.items.length === 0) return { items, total: page.total };
    if (items.length >= MAX_COMPLETE_ROSTER_ROWS) throw new OperationalRosterTooLargeError(MAX_COMPLETE_ROSTER_ROWS);
    offset += PAGE_SIZE;
  }
}
