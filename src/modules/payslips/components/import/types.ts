/**
 * UI-only types for the combined-PDF importer.
 *
 * The shared API contract lives in `src/modules/payslips/types.ts`. These
 * are page-local extensions (e.g. `savePayrollCode` is decided in the UI
 * before being sent up; the API contract makes it optional).
 */

import type {
  CombinedImportResponse,
  ManualMapping as ManualMappingApi,
} from '@/modules/payslips/types';

export interface ManualMapping extends ManualMappingApi {
  savePayrollCode: boolean;
}

export interface CasualDraft {
  page: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  employmentType: 'casual' | 'permanent';
}

export interface SkipDraft {
  page: number;
  reason: string;
}

export type Resolution =
  | { kind: 'match'; staffId: string }
  | { kind: 'casual' }
  | { kind: 'skip' }
  | null;

export interface PlanCounts {
  newRows: number;
  willUpdate: number;
  willSkip: number;
  willNoop: number;
  willCreate: number;
}

export interface UseCombinedImportApi {
  pdfFile: File | null;
  preview: CombinedImportResponse | null;
  submitting: boolean;
  error: string | null;
  manualByPage: Map<number, ManualMapping>;
  casualByPage: Map<number, CasualDraft>;
  skipByPage: Map<number, SkipDraft>;
  forceReimport: boolean;
  resolutionByPage: Map<number, Resolution>;
  allResolved: boolean;
  unresolvedCount: number;
  counts: PlanCounts;
  usedStaffIds: Set<string>;
  setPdfFile: (file: File | null) => void;
  setForceReimport: (v: boolean) => void;
  setMapping: (page: number, staffId: string | null, savePayrollCode: boolean) => void;
  setCasualDraft: (page: number, draft: CasualDraft | null) => void;
  toggleSkip: (page: number, reason?: string) => void;
  skipAllUnmatched: () => void;
  submit: (commit: boolean) => Promise<void>;
}
