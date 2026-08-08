export type QuickDateFilter =
  | 'today'
  | 'yesterday'
  | 'mtd'
  | 'currentCycle'
  | 'previousCycle'
  | 'all';

export interface DateRange {
  from: string;
  to: string;
}

/** Display order of the quick-filter buttons, and the inference order below. */
export const QUICK_DATE_FILTERS: readonly QuickDateFilter[] = [
  'today',
  'yesterday',
  'mtd',
  'currentCycle',
  'previousCycle',
  'all',
];

/** Build an inclusive month-to-date range from an existing YYYY-MM-DD SAST date. */
export function getMonthToDateRange(todaySAST: string): DateRange {
  return {
    from: `${todaySAST.slice(0, 7)}-01`,
    to: todaySAST,
  };
}

/**
 * Which quick-filter button should render as active for `current`.
 *
 * Several presets can produce byte-identical ranges, so range equality alone
 * cannot identify the one the user picked. On Monday the 1st of a month,
 * `today`, `mtd` and `currentCycle` are all `{1st, 1st}`; `mtd` and
 * `currentCycle` stay identical for the whole cycle week whenever the 1st is a
 * Monday. Inferring from dates alone always highlights whichever preset happens
 * to be tested first, which is not necessarily the one that was clicked.
 *
 * So `selected` — the last button actually clicked — wins. It is still checked
 * against the live range rather than trusted outright: `filters.dateFrom/dateTo`
 * live in ActivateDataContext and QaCentrePage writes them too, so a recorded
 * choice goes stale as soon as the user sets dates on another tab. When the
 * recorded choice no longer describes the current range we fall back to
 * inference, which is also what handles a hand-edited date range.
 */
export function resolveActiveQuickFilter(
  current: DateRange,
  rangeFor: (filter: QuickDateFilter) => DateRange,
  selected: QuickDateFilter | null
): QuickDateFilter {
  const matches = (filter: QuickDateFilter): boolean => {
    const range = rangeFor(filter);
    return current.from === range.from && current.to === range.to;
  };

  if (selected && matches(selected)) return selected;
  return QUICK_DATE_FILTERS.find(matches) ?? 'all';
}
