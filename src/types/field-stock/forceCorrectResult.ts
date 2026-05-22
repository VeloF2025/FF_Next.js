import type { ForceCorrectTarget, ForceCorrectSnapshot } from './forceCorrectTarget';

export interface ForceCorrectRowResult {
  serialNumber: string;
  found: boolean;
  applied: boolean;
  before?: ForceCorrectSnapshot;
  after?: ForceCorrectSnapshot;
  changedFields: (keyof ForceCorrectTarget)[];
  error?: string;
}

export interface ForceCorrectResult {
  dryRun: boolean;
  totalRequested: number;
  totalApplied: number;
  totalFailed: number;
  totalNoOp: number;
  rows: ForceCorrectRowResult[];
}
