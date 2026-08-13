/**
 * Who may see which action items, and what the caller asked for.
 *
 * Split from actionItems.ts to keep both inside the 300-line rule. The ACCESS type lives
 * here rather than beside the query because it is a claim about the caller, not about the
 * data: action items are meeting content, and FibreFlow gates meetings on attendance.
 */

export interface ActionItemAccess {
  isOwner: boolean;
  /** Lower-cased, matched against participants[].email. */
  email: string;
}

export interface ActionItemFilter {
  assignee?: string;
  /** 'open' (default) | 'completed' | 'all' */
  state: 'open' | 'completed' | 'all';
  /** Only items older than this many days. */
  olderThanDays?: number;
  source?: string;
  limit: number;
}

export function parseActionFilter(query: Record<string, string | string[] | undefined>):
  | { filter: ActionItemFilter }
  | { error: string } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const state = (one(query.state) ?? 'open') as ActionItemFilter['state'];
  if (!['open', 'completed', 'all'].includes(state)) {
    return { error: `state must be open, completed or all — got "${state}"` };
  }

  const olderRaw = one(query.olderThanDays);
  let olderThanDays: number | undefined;
  if (olderRaw !== undefined && olderRaw !== '') {
    const n = Number(olderRaw);
    if (!Number.isInteger(n) || n < 0) {
      return { error: `olderThanDays must be a non-negative integer — got "${olderRaw}"` };
    }
    olderThanDays = n;
  }

  // An empty string is "not given", not zero — Number('') is 0, which used to clamp up
  // to 1 and silently return a one-item sample.
  const limitStr = one(query.limit);
  const limitRaw = limitStr === undefined || limitStr === '' ? 25 : Number(limitStr);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 25;

  return {
    filter: {
      assignee: one(query.assignee) || undefined,
      state,
      olderThanDays,
      source: one(query.source) || undefined,
      limit,
    },
  };
}
