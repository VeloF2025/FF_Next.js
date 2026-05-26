import { describe, it, expect, vi } from 'vitest';
import {
  upsertStaffHolderWith,
  upsertContractorHolderWith,
  getOrCreateExternalHolderWith,
  syncTechnicianHolderWith,
  rowToHolder,
  type HolderExecutor,
} from '@/modules/procurement/field-stock/services/stockHolderService';

const dbRow = (over: Record<string, unknown> = {}) => ({
  id: 'h1', holder_type: 'staff', staff_id: 's1', contractor_id: null,
  name: 'Tech One', phone: '0810000000', email: null, is_active: true,
  created_at: new Date('2026-05-26T00:00:00Z'), updated_at: new Date('2026-05-26T00:00:00Z'),
  ...over,
});

// Records calls; queryOne returns queued responses (FIFO), default null.
function fakeExec(queueQueryOne: Array<unknown> = []) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const q = [...queueQueryOne];
  const exec: HolderExecutor & { calls: typeof calls } = {
    calls,
    query: vi.fn(async (text: string, params: unknown[] = []) => { calls.push({ text, params }); return []; }),
    queryOne: vi.fn(async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      return (q.length ? q.shift() : null) as never;
    }),
  };
  return exec;
}

describe('rowToHolder', () => {
  it('maps snake_case db columns to a camelCase StockHolder', () => {
    const h = rowToHolder(dbRow());
    expect(h).toMatchObject({ id: 'h1', holderType: 'staff', staffId: 's1', name: 'Tech One', isActive: true });
  });
});

describe('upsertStaffHolderWith', () => {
  it('emits an idempotent ON CONFLICT upsert keyed on the partial staff index', async () => {
    const exec = fakeExec([dbRow()]);
    const h = await upsertStaffHolderWith(exec, 's1', 'Tech One', '0810000000');
    const sql = exec.calls.map((c) => c.text).join('\n');
    expect(sql).toMatch(/INSERT INTO stock_holders/i);
    expect(sql).toMatch(/ON CONFLICT \(staff_id\) WHERE holder_type = 'staff'/i);
    expect(sql).toMatch(/DO UPDATE SET/i);
    expect(exec.calls[0].params).toEqual(['s1', 'Tech One', '0810000000']);
    expect(h.staffId).toBe('s1');
  });

  it('passes null (not undefined) for phone when omitted', async () => {
    const exec = fakeExec([dbRow()]);
    await upsertStaffHolderWith(exec, 's1', 'Tech One');
    expect(exec.calls[0].params).toEqual(['s1', 'Tech One', null]);
  });
});

describe('upsertContractorHolderWith', () => {
  it('emits an idempotent ON CONFLICT upsert keyed on the partial contractor index', async () => {
    const exec = fakeExec([dbRow({ holder_type: 'contractor', staff_id: null, contractor_id: 'c1', name: 'Acme' })]);
    const h = await upsertContractorHolderWith(exec, 'c1', 'Acme');
    const sql = exec.calls.map((c) => c.text).join('\n');
    expect(sql).toMatch(/ON CONFLICT \(contractor_id\) WHERE holder_type = 'contractor'/i);
    expect(exec.calls[0].params).toEqual(['c1', 'Acme']);
    expect(h.contractorId).toBe('c1');
  });
});

describe('getOrCreateExternalHolderWith', () => {
  it('returns the existing external holder without inserting (dedup on name+phone)', async () => {
    const exec = fakeExec([dbRow({ holder_type: 'external_person', staff_id: null, name: 'Freelancer', phone: '0820000000' })]);
    const h = await getOrCreateExternalHolderWith(exec, 'Freelancer', '0820000000');
    const texts = exec.calls.map((c) => c.text);
    expect(texts.some((t) => /SELECT .* FROM stock_holders/i.test(t) && /lower\(name\)/i.test(t))).toBe(true);
    expect(texts.some((t) => /INSERT INTO stock_holders/i.test(t))).toBe(false); // found → no insert
    expect(h.name).toBe('Freelancer');
  });

  it('inserts a new external holder when none matches', async () => {
    const exec = fakeExec([null, dbRow({ holder_type: 'external_person', staff_id: null, name: 'New Ext', phone: null })]);
    const h = await getOrCreateExternalHolderWith(exec, 'New Ext');
    const texts = exec.calls.map((c) => c.text);
    expect(texts.some((t) => /INSERT INTO stock_holders/i.test(t) && /'external_person'/i.test(t))).toBe(true);
    expect(h.name).toBe('New Ext');
  });
});

describe('syncTechnicianHolderWith (best-effort)', () => {
  it('upserts the staff holder when the executor works', async () => {
    const exec = fakeExec([dbRow()]);
    await syncTechnicianHolderWith(exec, 's1', 'Tech One', '0810000000');
    expect(exec.calls.some((c) => /INSERT INTO stock_holders/i.test(c.text))).toBe(true);
  });

  it('never throws when the upsert fails (location creation must not break)', async () => {
    const exec: HolderExecutor = {
      query: vi.fn(async () => { throw new Error('db down'); }),
      queryOne: vi.fn(async () => { throw new Error('db down'); }),
    };
    await expect(syncTechnicianHolderWith(exec, 's1', 'Tech One')).resolves.toBeUndefined();
  });

  it('logs (does not silently swallow) when the upsert fails', async () => {
    const { log } = await import('@/lib/logger');
    const spy = vi.spyOn(log, 'error').mockImplementation(() => {});
    const exec: HolderExecutor = {
      query: vi.fn(async () => { throw new Error('db down'); }),
      queryOne: vi.fn(async () => { throw new Error('db down'); }),
    };
    await syncTechnicianHolderWith(exec, 's1', 'Tech One');
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0]).toEqual(expect.arrayContaining([expect.objectContaining({ staffId: 's1' })]));
    spy.mockRestore();
  });
});
