import { describe, it, expect } from 'vitest';
import {
  checkVlmCorrectionSource,
  isKnownVlmSourceTable,
  KNOWN_VLM_SOURCE_TABLES,
} from '../vlmCorrectionSource';

describe('checkVlmCorrectionSource', () => {
  it('accepts a known table with a source_id (no warning, no fatal)', () => {
    const r = checkVlmCorrectionSource({
      sourceTable: 'dr_photo_unified_reviews',
      sourceId: '11111111-1111-1111-1111-111111111111',
    });
    expect(r.fatal).toBeNull();
    expect(r.warning).toBeNull();
  });

  it('accepts the virtual gallery source when linked by photo_url', () => {
    const r = checkVlmCorrectionSource({ sourceTable: 'gallery', photoUrl: 'https://x/y.jpg' });
    expect(r.fatal).toBeNull();
    expect(r.warning).toBeNull();
  });

  it('FATAL on an unknown source_table (typo / dropped table)', () => {
    const r = checkVlmCorrectionSource({ sourceTable: 'galery', photoUrl: 'https://x/y.jpg' });
    expect(r.fatal).toMatch(/unknown source_table 'galery'/);
    expect(r.warning).toBeNull();
  });

  it('WARNS (not fatal) when a known table has neither source_id nor photo_url', () => {
    const r = checkVlmCorrectionSource({ sourceTable: 'wa_photos' });
    expect(r.fatal).toBeNull();
    expect(r.warning).toMatch(/provenance incomplete/);
  });

  it('treats whitespace-only linkage as missing', () => {
    const r = checkVlmCorrectionSource({ sourceTable: 'wa_photos', sourceId: '   ', photoUrl: '' });
    expect(r.warning).toMatch(/provenance incomplete/);
  });

  it('is clean when no source_table is set at all (legacy null-provenance shape)', () => {
    const r = checkVlmCorrectionSource({ sourceTable: null, sourceId: null, photoUrl: null });
    expect(r.fatal).toBeNull();
    expect(r.warning).toBeNull();
  });

  it('trims a known table name before validating', () => {
    const r = checkVlmCorrectionSource({ sourceTable: '  fleet_check_records  ', sourceId: 'abc' });
    expect(r.fatal).toBeNull();
  });
});

describe('isKnownVlmSourceTable', () => {
  it('recognizes all configured tables', () => {
    for (const t of KNOWN_VLM_SOURCE_TABLES) expect(isKnownVlmSourceTable(t)).toBe(true);
  });
  it('rejects an unknown table', () => {
    expect(isKnownVlmSourceTable('nope')).toBe(false);
  });
});
