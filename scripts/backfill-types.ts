export interface BackfillResult {
  inserted?: number;
  updated?: number;
  wouldInsert?: number;
  wouldUpdate?: number;
  skipped?: number;
}
