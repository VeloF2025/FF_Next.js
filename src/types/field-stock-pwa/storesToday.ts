/**
 * Shared types for /api/my/stores/today + /my/stores/today.
 * Lives in src/types/ so service, API route, page, and hook all consume
 * from one source — no service→pages or page→pages layering violations.
 */

export interface StoresTodayRow extends Record<string, unknown> {
  technician_id: string;
  technician_name: string;
  issued_count: number;
  issued_value_rand: number;
  installed_count: number;
  returned_count: number;
  unaccounted_count: number;
}

export interface StoresTodayResponse {
  date: string;
  rows: StoresTodayRow[];
}
