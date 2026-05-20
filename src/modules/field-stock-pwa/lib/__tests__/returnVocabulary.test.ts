import { describe, it, expect } from 'vitest';
import { RETURN_REASONS, type ReturnReason } from '../returnReasons';
import { CONDITION_OPTIONS, type ReturnCondition } from '../conditionOptions';
import { DISPOSITION_OPTIONS, type ReturnDisposition } from '../dispositionOptions';

describe('Return vocabulary constants', () => {
  it('RETURN_REASONS codes match stock_return_lines.return_reason CHECK', () => {
    const codes = RETURN_REASONS.map((r) => r.code);
    expect(codes).toEqual([
      'unused', 'job_cancelled', 'wrong_item', 'excess', 'faulty', 'customer_refused',
    ]);
  });

  it('every RETURN_REASONS entry has a human label', () => {
    for (const r of RETURN_REASONS) {
      expect(r.label.length).toBeGreaterThan(0);
    }
  });

  it('CONDITION_OPTIONS subset matches stock_return_lines.condition CHECK', () => {
    const codes = CONDITION_OPTIONS.map((c) => c.code);
    expect(codes).toEqual(['good', 'damaged', 'non_functional']);
  });

  it('DISPOSITION_OPTIONS subset matches stock_return_lines.disposition CHECK', () => {
    const codes = DISPOSITION_OPTIONS.map((d) => d.code);
    expect(codes).toEqual(['restock', 'repair', 'scrap']);
  });
});
