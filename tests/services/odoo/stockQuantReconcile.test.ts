import { describe, it, expect } from 'vitest';
import { diffOdooVsFf, type FfQuant, type OdooAgg } from '@/services/odoo/entities/stockQuantReconcile';

describe('diffOdooVsFf', () => {
  it('matches equal quantities and reports deltas (sorted by magnitude)', () => {
    const odoo: OdooAgg[] = [
      { stockItemId: 'a', locationId: 'L1', name: 'A@L1', quantity: 100 },
      { stockItemId: 'b', locationId: 'L1', name: 'B@L1', quantity: 50 },
      { stockItemId: 'c', locationId: 'L2', name: 'C@L2', quantity: 10 },
    ];
    const ff: FfQuant[] = [
      { stockItemId: 'a', locationId: 'L1', quantity: 100 },  // match
      { stockItemId: 'b', locationId: 'L1', quantity: 30 },   // delta -20
      // c missing in FF -> delta -10
    ];
    const r = diffOdooVsFf(odoo, ff);
    expect(r.matches).toBe(1);
    expect(r.drift.map((d) => d.name)).toEqual(['B@L1', 'C@L2']); // |20| before |10|
    expect(r.drift[0]).toMatchObject({ odooQty: 50, ffQty: 30, delta: -20 });
    expect(r.drift[1]).toMatchObject({ odooQty: 10, ffQty: 0, delta: -10 });
  });

  it('reports FF-only surplus (Odoo zero) as positive-delta drift', () => {
    const odoo: OdooAgg[] = [{ stockItemId: 'a', locationId: 'L1', name: 'A@L1', quantity: 10 }];
    const ff: FfQuant[] = [
      { stockItemId: 'a', locationId: 'L1', quantity: 10 },
      { stockItemId: 'x', locationId: 'L9', quantity: 7 },
    ];
    const r = diffOdooVsFf(odoo, ff);
    expect(r.matches).toBe(1);
    expect(r.drift).toHaveLength(1);
    expect(r.drift[0]).toMatchObject({ stockItemId: 'x', locationId: 'L9', odooQty: 0, ffQty: 7, delta: 7 });
  });

  it('treats sub-0.001 differences as matches', () => {
    const r = diffOdooVsFf(
      [{ stockItemId: 'a', locationId: 'L1', name: 'A', quantity: 100.0005 }],
      [{ stockItemId: 'a', locationId: 'L1', quantity: 100 }],
    );
    expect(r.matches).toBe(1);
    expect(r.drift).toHaveLength(0);
  });
});
