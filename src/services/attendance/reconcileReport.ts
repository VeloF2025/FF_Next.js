import type { ReconciliationCounts } from './reconcileWriters';

export interface ReconcileReport extends ReconciliationCounts {
  scannedFrom: string;
  scannedTo: string;
  failedDayKeys: string[];
  startedAt: string;
  finishedAt: string;
}

export function emptyReport(from: string, to: string, startedAt: string): ReconcileReport {
  return {
    scannedFrom: from, scannedTo: to, systemClosed: 0, projectedDays: 0, unchangedDays: 0,
    skippedLockedDays: 0, missingClockOutExceptions: 0, missingClockInExceptions: 0,
    failedDayKeys: [], startedAt, finishedAt: '',
  };
}

export function countsFrom(report: ReconcileReport): ReconciliationCounts {
  return {
    systemClosed: report.systemClosed, projectedDays: report.projectedDays,
    unchangedDays: report.unchangedDays, skippedLockedDays: report.skippedLockedDays,
    missingClockOutExceptions: report.missingClockOutExceptions,
    missingClockInExceptions: report.missingClockInExceptions,
  };
}

export function runStatus(report: ReconcileReport): 'succeeded' | 'partial' | 'failed' {
  if (report.failedDayKeys.length === 0) return 'succeeded';
  return report.projectedDays + report.unchangedDays > 0 ? 'partial' : 'failed';
}
