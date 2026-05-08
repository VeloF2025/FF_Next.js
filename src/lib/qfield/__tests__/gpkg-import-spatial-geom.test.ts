import { describe, it, expect } from 'vitest';
import { buildZoneBoundariesInsertSql, buildPonBoundariesInsertSql } from '../gpkg-import-spatial';

describe('zone_boundaries INSERT includes geom', () => {
  it('uses ST_Multi+ST_MakeValid+ST_SetSRID+ST_GeomFromGeoJSON on the geojson column', () => {
    const sql = buildZoneBoundariesInsertSql('merge');
    expect(sql).toMatch(/INSERT INTO zone_boundaries.*\bgeom\b/s);
    expect(sql).toMatch(/ST_Multi\s*\(\s*ST_MakeValid\s*\(\s*ST_SetSRID\s*\(\s*ST_GeomFromGeoJSON/);
    expect(sql).toMatch(/4326/);
    expect(sql).toMatch(/geom\s*=\s*EXCLUDED\.geom|ON CONFLICT/);
  });
});

describe('pon_boundaries INSERT includes geom', () => {
  it('uses ST_Multi+ST_MakeValid+ST_SetSRID+ST_GeomFromGeoJSON', () => {
    const sql = buildPonBoundariesInsertSql('merge');
    expect(sql).toMatch(/INSERT INTO pon_boundaries.*\bgeom\b/s);
    expect(sql).toMatch(/ST_Multi\s*\(\s*ST_MakeValid\s*\(\s*ST_SetSRID\s*\(\s*ST_GeomFromGeoJSON/);
    expect(sql).toMatch(/4326/);
  });
});
