import { describe, it, expect } from 'vitest';
import { buildZoneBoundariesInsertSql, buildPonBoundariesInsertSql } from '../gpkg-import-spatial';

describe('zone_boundaries INSERT (merge mode)', () => {
  it('uses ST_Multi+ST_MakeValid+ST_SetSRID+ST_GeomFromGeoJSON on the geojson column', () => {
    const sql = buildZoneBoundariesInsertSql('merge');
    expect(sql).toMatch(/INSERT INTO zone_boundaries.*\bgeom\b/s);
    expect(sql).toMatch(/ST_Multi\s*\(\s*ST_MakeValid\s*\(\s*ST_SetSRID\s*\(\s*ST_GeomFromGeoJSON/);
    expect(sql).toMatch(/4326/);
  });

  it('updates geom on conflict (separately from the column-list assertion)', () => {
    // Splitting into two assertions because the previous combined regex
    // (`geom = EXCLUDED.geom | ON CONFLICT`) was vacuously satisfied by
    // any merge-mode SQL containing ON CONFLICT — even if geom was missing.
    const sql = buildZoneBoundariesInsertSql('merge');
    expect(sql).toMatch(/ON CONFLICT/);
    expect(sql).toMatch(/geom\s*=\s*EXCLUDED\.geom/);
  });
});

describe('zone_boundaries INSERT (replace mode)', () => {
  it('still includes geom in the column list and ST_Multi expression', () => {
    const sql = buildZoneBoundariesInsertSql('replace');
    expect(sql).toMatch(/INSERT INTO zone_boundaries.*\bgeom\b/s);
    expect(sql).toMatch(/ST_Multi\s*\(\s*ST_MakeValid\s*\(\s*ST_SetSRID\s*\(\s*ST_GeomFromGeoJSON/);
  });

  it('omits ON CONFLICT (replace mode runs after a DELETE)', () => {
    const sql = buildZoneBoundariesInsertSql('replace');
    expect(sql).not.toMatch(/ON CONFLICT/);
  });
});

describe('pon_boundaries INSERT (merge mode)', () => {
  it('uses ST_Multi+ST_MakeValid+ST_SetSRID+ST_GeomFromGeoJSON', () => {
    const sql = buildPonBoundariesInsertSql('merge');
    expect(sql).toMatch(/INSERT INTO pon_boundaries.*\bgeom\b/s);
    expect(sql).toMatch(/ST_Multi\s*\(\s*ST_MakeValid\s*\(\s*ST_SetSRID\s*\(\s*ST_GeomFromGeoJSON/);
    expect(sql).toMatch(/4326/);
  });

  it('updates geom on conflict', () => {
    const sql = buildPonBoundariesInsertSql('merge');
    expect(sql).toMatch(/ON CONFLICT/);
    expect(sql).toMatch(/geom\s*=\s*EXCLUDED\.geom/);
  });
});

describe('pon_boundaries INSERT (replace mode)', () => {
  it('still includes geom in the column list and ST_Multi expression', () => {
    const sql = buildPonBoundariesInsertSql('replace');
    expect(sql).toMatch(/INSERT INTO pon_boundaries.*\bgeom\b/s);
    expect(sql).toMatch(/ST_Multi\s*\(\s*ST_MakeValid\s*\(\s*ST_SetSRID\s*\(\s*ST_GeomFromGeoJSON/);
  });

  it('omits ON CONFLICT (replace mode runs after a DELETE)', () => {
    const sql = buildPonBoundariesInsertSql('replace');
    expect(sql).not.toMatch(/ON CONFLICT/);
  });
});
