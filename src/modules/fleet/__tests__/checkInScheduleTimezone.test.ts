import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queries: [] as string[],
  sql: vi.fn(),
}));

vi.mock('@/lib/db-neon', () => ({
  neon: () => mocks.sql,
}));

vi.mock('@/lib/security/sanitization', () => ({
  sanitizeText: (value: string | null | undefined) => value ?? '',
}));

import { createCheckRecord } from '../services/checkInService';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queries.length = 0;
  mocks.sql.mockImplementation(
    async (strings: TemplateStringsArray) => {
      const query = strings.join('?');
      mocks.queries.push(query);

      if (query.includes('INSERT INTO fleet_check_records')) {
        return [
          {
            id: 'record-1',
            vehicle_id: 'vehicle-1',
            template_id: null,
            driver_id: 'staff-1',
            driver_name: 'Assigned Driver',
            check_type: 'daily',
            check_date: '2026-07-30',
            check_time: '00:30:00',
            odometer_reading: null,
            status: 'completed',
            has_critical_issues: false,
            has_minor_issues: false,
            approved_by: null,
            approved_at: null,
            approval_notes: null,
            sync_status: 'synced',
            offline_id: null,
            created_at: '2026-07-29T22:30:00.000Z',
            updated_at: '2026-07-29T22:30:00.000Z',
          },
        ];
      }

      return [];
    }
  );
});

describe('fleet check schedule work date', () => {
  it('records completion using the Johannesburg date at the midnight boundary', async () => {
    await createCheckRecord({
      vehicleId: 'vehicle-1',
      driverId: 'staff-1',
      driverName: 'Assigned Driver',
      checkType: 'daily',
      responses: [],
    });

    const scheduleQuery = mocks.queries.find((query) =>
      query.includes('INSERT INTO fleet_check_schedule')
    );

    expect(scheduleQuery).toContain(
      "NOW() AT TIME ZONE 'Africa/Johannesburg'"
    );
  });
});
