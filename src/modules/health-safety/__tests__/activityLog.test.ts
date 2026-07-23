/**
 * H&S Activity Log helper tests
 *
 * The helper must:
 * 1. Write the LIVE hs_activity_log columns (activity_type, entity_type,
 *    entity_id, description, metadata) — never the legacy action/actor_id/details.
 * 2. Record the authenticated user inside metadata (live user_id column is
 *    INTEGER legacy staff ref; app users are UUIDs).
 * 3. NEVER throw — a failed log write logs a warning and resolves.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const sqlMock = vi.hoisted(() => vi.fn());

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlMock),
  neonConfig: { fetchConnectionCache: false },
}));

import { log } from '@/lib/logger';
import { logHsActivity } from '../services/activityLog';

function queryText(call: unknown[]): string {
  return (call[0] as string[]).join('?');
}

describe('logHsActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlMock.mockResolvedValue([]);
  });

  it('writes the live hs_activity_log columns', async () => {
    await logHsActivity({
      activityType: 'risk_created',
      entityType: 'risk',
      entityId: '123e4567-e89b-12d3-a456-426614174000',
      description: 'Risk created',
      metadata: { risk_score: 9 },
    });

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const text = queryText(sqlMock.mock.calls[0]!);
    expect(text).toContain('INSERT INTO hs_activity_log');
    expect(text).toContain('activity_type');
    expect(text).toContain('entity_type');
    expect(text).toContain('entity_id');
    expect(text).toContain('description');
    expect(text).toContain('metadata');
    // Legacy columns must never appear
    expect(text).not.toContain('actor_id');
    expect(text).not.toContain('details');
    expect(text).not.toMatch(/\baction\b/);

    const values = sqlMock.mock.calls[0]!.slice(1);
    expect(values[0]).toBe('risk_created');
    expect(values[1]).toBe('risk');
    expect(values[2]).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(values[3]).toBe('Risk created');
    expect(JSON.parse(values[4] as string)).toEqual({ risk_score: 9 });
  });

  it('records the authenticated user in metadata', async () => {
    await logHsActivity({
      activityType: 'capa_created',
      entityType: 'capa',
      entityId: '123e4567-e89b-12d3-a456-426614174001',
      user: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', email: 'user@velocityfibre.co.za' },
      metadata: { title: 'Fix guardrail' },
    });

    const values = sqlMock.mock.calls[0]!.slice(1);
    const metadata = JSON.parse(values[4] as string);
    expect(metadata.user_id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(metadata.user_email).toBe('user@velocityfibre.co.za');
    expect(metadata.title).toBe('Fix guardrail');
  });

  it('defaults optional fields to null', async () => {
    await logHsActivity({ activityType: 'template_seeded' });

    const values = sqlMock.mock.calls[0]!.slice(1);
    expect(values[1]).toBeNull();
    expect(values[2]).toBeNull();
    expect(values[3]).toBeNull();
    expect(JSON.parse(values[4] as string)).toEqual({});
  });

  it('never throws when the insert fails — warns instead', async () => {
    sqlMock.mockRejectedValueOnce(new Error('column "action" does not exist'));

    await expect(
      logHsActivity({ activityType: 'incident_reported', entityId: 'not-a-uuid' })
    ).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
