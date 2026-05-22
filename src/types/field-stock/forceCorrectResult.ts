import type { ForceCorrectTarget } from './forceCorrectTarget';

export interface ForceCorrectRowResult {
  serialNumber: string;
  found: boolean;
  applied: boolean;
  before?: Partial<ForceCorrectTarget>;
  after?: Partial<ForceCorrectTarget>;
  changedFields: string[];
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
