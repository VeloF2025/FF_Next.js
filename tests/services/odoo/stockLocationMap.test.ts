import { describe, it, expect } from 'vitest';
import { odooLocationToFfCode } from '@/services/odoo/stockLocationMap';

describe('odooLocationToFfCode', () => {
  it('maps known site tokens to FF warehouse codes', () => {
    expect(odooLocationToFfCode('VF/Law/Stock')).toBe('WH-Law');
    expect(odooLocationToFfCode('Moh/Stock')).toBe('WH-Moh');
    expect(odooLocationToFfCode('MamP1/Stock')).toBe('WH-MamP1');
    expect(odooLocationToFfCode('Tem1/Stock')).toBe('WH-Tem1');
    expect(odooLocationToFfCode('ETW/Stock')).toBe('WH-ETW');
    expect(odooLocationToFfCode('TAV/Stock')).toBe('WH-TAV');
  });
  it('returns null for unmapped / non-physical locations', () => {
    expect(odooLocationToFfCode('Partners/Customers')).toBeNull();
    expect(odooLocationToFfCode('Virtual Locations/Vendors')).toBeNull();
    expect(odooLocationToFfCode('WH/Stock/Transit')).toBeNull();
  });

  // Table-driven: guards against future drift in TOKEN_TO_CODE. Every token in
  // the map must resolve from its "<token>/Stock" complete_name.
  it.each([
    ['VF/Law/Stock', 'WH-Law'],
    ['Moh/Stock', 'WH-Moh'],
    ['MamP1/Stock', 'WH-MamP1'],
    ['Tem1/Stock', 'WH-Tem1'],
    ['Tem2/Stock', 'WH-Tem2'],
    ['Tem3/Stock', 'WH-Tem3'],
    ['ETW/Stock', 'WH-ETW'],
    ['GR/Stock', 'WH-GR'],
    ['IP/Stock', 'WH-IP'],
    ['TAV/Stock', 'WH-TAV'],
    ['TBL/Stock', 'WH-TBL'],
  ])('maps %s -> %s', (name, code) => {
    expect(odooLocationToFfCode(name)).toBe(code);
  });
});
