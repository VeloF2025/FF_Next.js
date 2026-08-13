export interface ContinuityFix {
  recordedAt: string; valid: boolean; inside: boolean; distanceM: number; speedKmh: number;
}

export interface ContinuityResult {
  confirmed: boolean; pending: boolean; sequenceLength: number;
  startedAt: string | null; latestAt: string | null; durationSeconds: number;
}

interface TimedFix extends ContinuityFix { timestamp: number }

function usableFixes(fixes: ContinuityFix[], staleAfterSeconds: number, asOf: string): TimedFix[] {
  if (!Number.isFinite(staleAfterSeconds) || staleAfterSeconds < 0) return [];
  const evaluatedAt = Date.parse(asOf);
  if (!Number.isFinite(evaluatedAt)) return [];
  const usable = fixes.flatMap((fix) => {
    const timestamp = Date.parse(fix.recordedAt);
    return fix.valid && Number.isFinite(timestamp) && timestamp <= evaluatedAt
      && evaluatedAt - timestamp <= staleAfterSeconds * 1_000 ? [{ ...fix, timestamp }] : [];
  }).sort((a, b) => a.timestamp - b.timestamp);
  return usable;
}

function newestSequence(fixes: TimedFix[], staleAfterSeconds: number, state: boolean): TimedFix[] {
  const sequence: TimedFix[] = [];
  for (let index = fixes.length - 1; index >= 0; index -= 1) {
    const current = fixes[index]!;
    if (current.inside !== state) break;
    const newer = sequence[0];
    if (newer && newer.timestamp - current.timestamp > staleAfterSeconds * 1_000) break;
    sequence.unshift(current);
  }
  return sequence;
}

function continuousState(fixes: ContinuityFix[], durationSeconds: number, staleAfterSeconds: number, asOf: string, state: boolean): ContinuityResult {
  const sequence = newestSequence(usableFixes(fixes, staleAfterSeconds, asOf), staleAfterSeconds, state);
  const first = sequence[0]; const latest = sequence.at(-1);
  const duration = first && latest ? (latest.timestamp - first.timestamp) / 1_000 : 0;
  return { confirmed: sequence.length >= 2 && duration >= durationSeconds, pending: sequence.length > 0,
    sequenceLength: sequence.length, startedAt: first?.recordedAt ?? null, latestAt: latest?.recordedAt ?? null,
    durationSeconds: duration };
}

export const continuousInside = (fixes: ContinuityFix[], durationSeconds: number, staleAfterSeconds: number, asOf: string): ContinuityResult =>
  continuousState(fixes, durationSeconds, staleAfterSeconds, asOf, true);

export const continuousOutside = (fixes: ContinuityFix[], durationSeconds: number, staleAfterSeconds: number, asOf: string): ContinuityResult =>
  continuousState(fixes, durationSeconds, staleAfterSeconds, asOf, false);

export function approachTrend(fixes: ContinuityFix[], minimumReadings: number, maximumDistanceM: number,
  minimumSpeedKmh: number, staleAfterSeconds: number, asOf: string): boolean {
  if (!Number.isInteger(minimumReadings) || minimumReadings < 2) return false;
  const usable = usableFixes(fixes, staleAfterSeconds, asOf);
  const continuous = newestSequenceByGap(usable, staleAfterSeconds).slice(-minimumReadings);
  if (continuous.length < minimumReadings || continuous.some((fix) => !Number.isFinite(fix.distanceM)
    || !Number.isFinite(fix.speedKmh) || fix.speedKmh < minimumSpeedKmh)) return false;
  if (continuous.at(-1)!.distanceM > maximumDistanceM) return false;
  return continuous.every((fix, index) => index === 0 || fix.distanceM < continuous[index - 1]!.distanceM);
}

function newestSequenceByGap(fixes: TimedFix[], staleAfterSeconds: number): TimedFix[] {
  const sequence: TimedFix[] = [];
  for (let index = fixes.length - 1; index >= 0; index -= 1) {
    const current = fixes[index]!; const newer = sequence[0];
    if (newer && newer.timestamp - current.timestamp > staleAfterSeconds * 1_000) break;
    sequence.unshift(current);
  }
  return sequence;
}
