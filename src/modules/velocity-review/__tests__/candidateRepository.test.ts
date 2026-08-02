import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('@/lib/db-pool', () => ({ query: mocks.query }));

import { listCandidateRows } from '../candidateRepository';

describe('listCandidateRows SAST source boundaries', () => {
  beforeEach(() => {
    mocks.query.mockReset().mockResolvedValue([]);
  });

  it('emits one date boundary for each source and converts every timestamp in SAST', async () => {
    await listCandidateRows('2026-07-31');

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(['2026-07-31']);
    expect(sql).toMatch(/r\.submitted_date = p\.target_date/);
    expect(sql).toMatch(/\(d\.installed_at AT TIME ZONE 'Africa\/Johannesburg'\)::date,[\s\S]*d\.installation_date\) = p\.target_date/);
    expect(sql).toMatch(/\(s\.installed_date AT TIME ZONE 'Africa\/Johannesburg'\)::date = p\.target_date/);
    expect(sql).toMatch(/\(o\.activation_datetime AT TIME ZONE 'Africa\/Johannesburg'\)::date,[\s\S]*o\.activation_date\) = p\.target_date/);
    expect(sql).toMatch(/\(COALESCE\(pp\.activated_at, pp\.first_resolved_at, pp\.resolved_at\)[\s\S]*AT TIME ZONE 'Africa\/Johannesburg'\)::date = p\.target_date/);
    expect(sql).toMatch(/\(m\.created_at AT TIME ZONE 'Africa\/Johannesburg'\)::date = p\.target_date/);
  });
});
