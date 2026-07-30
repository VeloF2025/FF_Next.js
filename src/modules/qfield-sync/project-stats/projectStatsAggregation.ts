import type { ProjectStatsAnomaly } from './types';

export interface Comparison {
  synchronized: number;
  needsSync: number;
  leftOnly: number;
  rightOnly: number;
}

export function normalizeStatsValue(value: string | null): string {
  return value?.trim().toLowerCase() ?? '';
}

function normalizedMap<T>(records: Map<string, T>): Map<string, T> {
  const normalized = new Map<string, T>();
  for (const [key, value] of records) {
    if (normalizeStatsValue(key)) normalized.set(normalizeStatsValue(key), value);
  }
  return normalized;
}

export function reconcileStatsRecords<T>(
  left: Map<string, T>,
  right: Map<string, T>,
  matches: (leftValue: T, rightValue: T) => boolean,
): Comparison {
  const normalizedLeft = normalizedMap(left);
  const normalizedRight = normalizedMap(right);
  let synchronized = 0;
  let needsSync = 0;
  let leftOnly = 0;
  for (const [identity, leftValue] of normalizedLeft) {
    const rightValue = normalizedRight.get(identity);
    if (!rightValue) leftOnly += 1;
    else if (matches(leftValue, rightValue)) synchronized += 1;
    else needsSync += 1;
  }
  const rightOnly = [...normalizedRight.keys()].filter(
    (identity) => !normalizedLeft.has(identity),
  ).length;
  return { synchronized, needsSync, leftOnly, rightOnly };
}

export function addPhotoIntegrity(
  photoKeys: Set<string>,
  presentKeys: Set<string> | null,
  anomalies: ProjectStatsAnomaly[],
): { present: number | null; missing: number | null } {
  if (!presentKeys) return { present: null, missing: null };
  const normalizedPresent = new Set([...presentKeys].map((key) => key.trim()));
  const missing = [...photoKeys].filter((key) => !normalizedPresent.has(key));
  for (const key of missing) {
    anomalies.push({
      type: 'missing_photo',
      featureKey: key,
      label: null,
      status: null,
      occurredAt: null,
    });
  }
  return { present: photoKeys.size - missing.length, missing: missing.length };
}
