/**
 * Fixtures are real rows from the production catalogue on 2026-08-21 — the
 * exact items a clerk reported as missing when the list was capped at 100.
 */
import { describe, it, expect } from 'vitest';
import { itemMatchesQuery, filterStockItems, itemSubtitle } from '../itemSearch';

const SPLITTER = { id: '1', itemCode: 'OPT-116BF', name: '1:16 Bare Fibre Splitter', category: 'optics', trackingType: 'quantity' };
const GLAND = { id: '2', itemCode: 'OPT-D4WG', name: 'DOME-4WAY-GLAND', category: 'optics', trackingType: 'quantity' };
const OVAL = { id: '3', itemCode: 'CON-OVAL', name: 'MECH SEAL MEDIUM OVAL KIT 13-14.8mm', category: 'consumable', trackingType: 'quantity' };
const FIBRE = { id: '4', itemCode: 'STR-AF48', name: 'Aerial Fibre cable 10.4mm 48f', category: 'stringing', trackingType: 'quantity' };
const ONT = { id: '5', itemCode: 'ACT-ONT', name: 'ONT Device', category: 'activations', trackingType: 'serial' };
const ALL = [ONT, OVAL, SPLITTER, GLAND, FIBRE];

describe('itemMatchesQuery', () => {
  it('finds the splitter the capped list hid', () => {
    expect(itemMatchesQuery(SPLITTER, 'splitter')).toBe(true);
  });

  it('finds the 4-way gland by its hyphenated name', () => {
    expect(itemMatchesQuery(GLAND, '4way')).toBe(true);
  });

  it('finds the oval kit mid-string', () => {
    expect(itemMatchesQuery(OVAL, 'oval')).toBe(true);
  });

  it('finds fibre cable, which sorted 218th and was unreachable', () => {
    expect(itemMatchesQuery(FIBRE, 'fibre cable')).toBe(true);
  });

  it('matches on item code', () => {
    expect(itemMatchesQuery(SPLITTER, 'opt-116')).toBe(true);
  });

  it('matches on category, the axis the old cap cut along', () => {
    expect(itemMatchesQuery(SPLITTER, 'optics')).toBe(true);
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(itemMatchesQuery(GLAND, '  DOME-4way  ')).toBe(true);
  });

  it('rejects a genuine non-match', () => {
    expect(itemMatchesQuery(SPLITTER, 'pole')).toBe(false);
  });

  it('matches everything on an empty query', () => {
    expect(itemMatchesQuery(SPLITTER, '')).toBe(true);
  });

  it('does not throw on missing category or code', () => {
    expect(itemMatchesQuery({ id: 'x', itemCode: '', name: 'Thing' }, 'thing')).toBe(true);
  });
});

describe('filterStockItems', () => {
  it('narrows the catalogue to the searched item', () => {
    expect(filterStockItems(ALL, 'splitter').map((i) => i.id)).toEqual(['1']);
  });

  it('returns every item for an empty query', () => {
    expect(filterStockItems(ALL, '')).toHaveLength(5);
  });

  it('preserves the server ordering rather than resorting', () => {
    expect(filterStockItems(ALL, '').map((i) => i.id)).toEqual(['5', '3', '1', '2', '4']);
  });

  it('returns every optics item when searching the category', () => {
    expect(filterStockItems(ALL, 'optics').map((i) => i.id)).toEqual(['1', '2']);
  });

  it('returns empty rather than everything when nothing matches', () => {
    expect(filterStockItems(ALL, 'zzzz')).toEqual([]);
  });

  it('does not mutate the input', () => {
    filterStockItems(ALL, 'splitter');
    expect(ALL.map((i) => i.id)).toEqual(['5', '3', '1', '2', '4']);
  });
});

describe('itemSubtitle', () => {
  it('shows the category', () => {
    expect(itemSubtitle(SPLITTER)).toBe('optics');
  });

  it('flags serial-tracked items, which behave differently on a picking', () => {
    expect(itemSubtitle(ONT)).toBe('activations · serial-tracked');
  });

  it('degrades to an empty string with no category', () => {
    expect(itemSubtitle({ id: 'x', itemCode: 'C', name: 'N' })).toBe('');
  });
});
