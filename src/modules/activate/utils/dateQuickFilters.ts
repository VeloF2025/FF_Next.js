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

/** Build an inclusive month-to-date range from an existing YYYY-MM-DD SAST date. */
export function getMonthToDateRange(todaySAST: string): DateRange {
  return {
    from: `${todaySAST.slice(0, 7)}-01`,
    to: todaySAST,
  };
}
