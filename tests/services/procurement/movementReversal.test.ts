/**
 * reverseMovement — the reversal (create inverse movement, mark original
 * reversed, revert quantities, revert serials) must run inside ONE db-pool
 * transaction so a partial failure can't flag a movement reversed with stock
 * never restored. Guard failures roll back and surface {success:false}.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface RecordedQuery { text: string; params: unknown[] }

const cfg: { movement: Record<string, unknown> | null } = { movement: null };
const recorded: RecordedQuery[] = [];

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), promoteSerial: vi.fn(), createAuditLog: vi.fn() }));

vi.mock('@/lib/db-pool', () => ({ transaction: mocks.transaction, pool: {} }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('@/services/procurement/auditService', () => ({ createAuditLog: mocks.createAuditLog }));
vi.mock('@/modules/procurement/field-stock/services/serialLifecycle', () => ({ promoteSerial: mocks.promoteSerial }));

import { reverseMovement } from '@/services/procurement/movementReversalService';

function fakeTxn() {
  const respond = (text: string): unknown[] => {
    if (/FROM stock_movements WHERE id = \$1 FOR UPDATE/i.test(text)) {
      return cfg.movement ? [cfg.movement] : [];
    }
    if (/INSERT INTO stock_movements[\s\S]*RETURNING id/i.test(text)) return [{ id: 'rev-1' }];
    if (/FROM stock_movement_items/i.test(text)) return []; // no line items → simplest path
    return [];
  };
  return {
    client: {},
    async query(text: string, params: unknown[] = []) { recorded.push({ text, params }); return respond(text); },
    async queryOne(text: string, params: unknown[] = []) { recorded.push({ text, params }); return respond(text)[0] ?? null; },
  };
}

const PARAMS = { movementId: 'mv-1', reason: 'wrong bin', performedBy: 'user-1', performedByName: 'Ann' };

describe('reverseMovement atomicity', () => {
  beforeEach(() => {
    recorded.length = 0;
    vi.clearAllMocks();
    mocks.transaction.mockImplementation((cb: (t: unknown) => Promise<unknown>) => cb(fakeTxn()));
    cfg.movement = { id: 'mv-1', movement_type: 'GRN', from_location: 'A', to_location: 'B', status: 'completed', is_reversed: false, reference_number: 'GRN-1', reference_type: 'goods_receipt_note', reference_id: 'g1', project_id: 'fibreflow', notes: null, source_type: 'fibreflow' };
  });

  it('runs the whole reversal inside a single transaction and marks the original reversed', async () => {
    const result = await reverseMovement(PARAMS);

    expect(result.success).toBe(true);
    expect(result.reversalMovementId).toBe('rev-1');
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    // The inverse-movement insert AND the mark-reversed update both ran on the txn.
    expect(recorded.some(q => /INSERT INTO stock_movements/i.test(q.text))).toBe(true);
    expect(recorded.some(q => /is_reversed = true/i.test(q.text))).toBe(true);
    // The original was locked FOR UPDATE (serializes concurrent reversals).
    expect(recorded.some(q => /FOR UPDATE/i.test(q.text))).toBe(true);
  });

  it('rejects an already-reversed movement without writing anything', async () => {
    cfg.movement = { ...cfg.movement!, is_reversed: true };
    const result = await reverseMovement(PARAMS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already been reversed/i);
    expect(recorded.some(q => /INSERT INTO stock_movements/i.test(q.text))).toBe(false);
    expect(recorded.some(q => /is_reversed = true/i.test(q.text))).toBe(false);
  });

  it('rejects a non-completed movement', async () => {
    cfg.movement = { ...cfg.movement!, status: 'draft' };
    const result = await reverseMovement(PARAMS);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/only completed/i);
  });

  it('returns not-found when the movement does not exist', async () => {
    cfg.movement = null;
    const result = await reverseMovement(PARAMS);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });
});
