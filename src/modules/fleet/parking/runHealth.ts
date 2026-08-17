export type ParkingRunStatus = 'running' | 'succeeded' | 'partial_failure' | 'failed';

export interface ParkingRunRecord {
  id: string;
  checkDate: string;
  startedAt: string;
  completedAt: string | null;
  status: ParkingRunStatus;
  evaluatedCount: number;
  violationCount: number;
  recordErrorCount: number;
  notificationWarningCount: number;
  errorSummary: string | null;
}

export interface ParkingRunHealth {
  state: 'healthy' | 'warning' | 'failed';
  reason: string | null;
  latestRun: ParkingRunRecord | null;
  latestSuccessfulRun: ParkingRunRecord | null;
  expectedNextRunAt: string;
}

const sastDate = (date: Date) => new Date(date.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
const expectedAt = (date: string, hour: number, minute: number) => new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+02:00`);

export function expectedParkingCheckDate(now: Date): string {
  const today = sastDate(now);
  if (now.getTime() >= expectedAt(today, 20, 30).getTime()) return today;
  return new Date(expectedAt(today, 20, 0).getTime() - 86400000).toISOString().slice(0, 10);
}

export function deriveParkingRunHealth(
  latest: ParkingRunRecord | null,
  latestSuccess: ParkingRunRecord | null,
  now: Date
): ParkingRunHealth {
  const today = sastDate(now);
  const afterGrace = now.getTime() >= expectedAt(today, 20, 30).getTime();
  const expectedCheckDate = expectedParkingCheckDate(now);
  const expectedNextRunAt = expectedAt(afterGrace ? new Date(expectedAt(today, 20, 0).getTime() + 86400000).toISOString().slice(0, 10) : today, 20, 0).toISOString();
  const output = (state: ParkingRunHealth['state'], reason: string | null): ParkingRunHealth => ({ state, reason, latestRun: latest, latestSuccessfulRun: latestSuccess, expectedNextRunAt });
  const expectedRun = latest?.checkDate === today
    ? latest
    : latest?.checkDate === expectedCheckDate
    ? latest
    : latestSuccess?.checkDate === expectedCheckDate ? latestSuccess : null;
  if (!expectedRun) {
    const label = afterGrace ? 'Today’s' : 'Yesterday’s';
    return output('failed', latest ? `${label} parking check has not completed` : 'No parking check run has been recorded');
  }
  if (expectedRun.status === 'running') {
    const stale = now.getTime() - new Date(expectedRun.startedAt).getTime() >= 15 * 60 * 1000;
    return output(stale ? 'failed' : 'warning', stale ? 'Parking check has been running for more than 15 minutes' : 'Parking check is running');
  }
  if (expectedRun.status === 'failed') return output('failed', expectedRun.errorSummary ?? 'Latest parking check failed');
  if (expectedRun.status === 'partial_failure') return output('warning', 'Latest parking check completed with warnings');
  return output('healthy', null);
}
