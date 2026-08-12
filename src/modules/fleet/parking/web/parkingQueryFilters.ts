import { PARKING_CHECK_RESULTS } from '@/modules/fleet/parking/types';
import type { ParkingCheckResult } from '@/modules/fleet/parking/types';

type RouterQuery = Record<string, string | string[] | undefined>;

export interface ParkingQueryFilters {
  date?: string;
  result?: ParkingCheckResult;
}

function singleValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parkingQueryFilters(query: RouterQuery): ParkingQueryFilters {
  const date = singleValue(query.date);
  const result = singleValue(query.result);

  return {
    ...(date && isIsoDate(date) ? { date } : {}),
    ...(result && PARKING_CHECK_RESULTS.some((candidate) => candidate === result)
      ? { result: result as ParkingCheckResult }
      : {}),
  };
}
