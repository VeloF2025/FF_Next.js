import { describe, it, expect } from 'vitest';
import { buildSeedPlan } from '@/services/odoo/entities/stockQuantSeed';
import type { OdooStockQuant } from '@/services/odoo/odooClient';

const quant = (pid: number, pname: string, lid: number, lname: string, qty: number): OdooStockQuant =>
  ({ id: pid * 100 + lid, product_id: [pid, pname], location_id: [lid, lname], quantity: qty, reserved_quantity: 0 } as OdooStockQuant);

describe('buildSeedPlan', () => {
  const productMap = new Map<number, string>([[243, 'item-cab'], [249, 'item-cab9']]);
  const locationMap = new Map<number, string>([[8, 'loc-law'], [9, 'loc-moh']]);

  it('aggregates quants per (product, location) into seed rows', () => {
    const plan = buildSeedPlan(
      [quant(243, 'CAB-144F', 8, 'VF/Law/Stock', 16000), quant(243, 'CAB-144F', 8, 'VF/Law/Stock', 4000)],
      productMap, locationMap,
    );
    expect(plan.rows).toEqual([{ stockItemId: 'item-cab', locationId: 'loc-law', quantity: 20000 }]);
    expect(plan.gaps).toEqual([]);
  });

  it('reports a product gap when odoo product is unmapped (no double-write)', () => {
    const plan = buildSeedPlan([quant(999, 'Vendor Labour', 8, 'VF/Law/Stock', 5)], productMap, locationMap);
    expect(plan.rows).toEqual([]);
    expect(plan.gaps).toEqual([{ kind: 'product', odooId: 999, name: 'Vendor Labour', quantity: 5, location: 'VF/Law/Stock' }]);
  });

  it('reports a location gap when odoo location is unmapped', () => {
    const plan = buildSeedPlan([quant(243, 'CAB-144F', 77, 'Partners/Customers', 5)], productMap, locationMap);
    expect(plan.rows).toEqual([]);
    expect(plan.gaps).toEqual([{ kind: 'location', odooId: 77, name: 'Partners/Customers', quantity: 5, product: 'CAB-144F' }]);
  });
});
