import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

/**
 * Cross-checks `QFIELD_TO_FIBREFLOW` against `scripts/qfield_project_registry.py`.
 *
 * The two are independent copies of one mapping — the Python registry gates EXTRACTION
 * (GPKG → qfield_photo_validations), this map gates INGEST (→ construction_qa_*). A
 * project registered in one and absent from the other keeps working right up to the
 * boundary and then silently stops, with no error anywhere. That is exactly what
 * happened: Mahikeng, Cradock, Middelburg, Namakgale and Ben Farm were extracted for
 * months while 6,242 photos accumulated and zero reviews were created.
 *
 * The authoritative mapping is really `qfield_projects` ⋈ `qfield_project_links` in the
 * database, but CI has no access to it. Comparing the two in-repo copies catches the
 * drift that actually occurred and needs nothing but the filesystem.
 *
 * Coverage is PARTIAL and the gap matters: the registry knows 13 of the map's 19
 * entries, so the other 6 (the four original *Pole Audit* projects, MAM offline,
 * ETWpoc1 and anything else map-only) are checked here for duplicate keys and nothing
 * else. A wrong-but-well-formed UUID on one of those passes. Only a query against
 * `qfield_projects` ⋈ `qfield_project_links` catches those, and CI has no DB.
 */
const REPO_ROOT = join(__dirname, '../../../../..');
const SERVICE = join(REPO_ROOT, 'src/modules/construction-qa/services/qfieldIngestionService.ts');
const REGISTRY = join(REPO_ROOT, 'scripts/qfield_project_registry.py');

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Registry blocks in `scripts/qfield_project_registry.py`. Bump deliberately. */
const REGISTRY_ENTRY_COUNT = 13;

/**
 * Text between two markers, throwing if either is missing.
 *
 * `indexOf` returns -1 for an absent marker, and `slice(start, -1)` then silently means
 * "the rest of the file bar one char" — so renaming the end marker would quietly widen
 * the region instead of failing, and any later `'uuid': 'uuid'` pair would be absorbed
 * into the map under test.
 */
function sliceBetween(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  if (start < 0) throw new Error(`marker not found: ${startMarker}`);
  if (end < start) throw new Error(`marker not found after ${startMarker}: ${endMarker}`);
  return src.slice(start, end);
}

/** {qf_uuid: ff_uuid} parsed from the TS literal. */
function tsMap(): Map<string, string> {
  const body = sliceBetween(readFileSync(SERVICE, 'utf8'),
    'const QFIELD_TO_FIBREFLOW', 'const FIBREFLOW_TO_QFIELD');
  const out = new Map<string, string>();
  for (const m of body.matchAll(new RegExp(`'(${UUID})':\\s*'(${UUID})'`, 'g'))) {
    out.set(m[1], m[2]);
  }
  return out;
}

/** {name: {qf, ff}} parsed from the Python PROJECTS literal. */
function registry(): Array<{ name: string; qf: string; ff: string }> {
  const body = sliceBetween(readFileSync(REGISTRY, 'utf8'), 'PROJECTS = {', 'ALTERNATE_GPKGS');
  const blocks = body.matchAll(
    new RegExp(
      // Quote class is ["'] throughout: Python accepts either, the file happens to use
      // double and no linter pins that. A single-quoted block would otherwise be
      // invisible — and invisibly ADDED, which the exact count above cannot catch
      // because the parsed total would still equal REGISTRY_ENTRY_COUNT.
      `["']([^"']+)["']:\\s*\\{[^}]*?["']qf_project_id["']:\\s*["'](${UUID})["'][^}]*?["']ff_project_id["']:\\s*["'](${UUID})["']`,
      'gs',
    ),
  );
  return [...blocks].map((m) => ({ name: m[1], qf: m[2], ff: m[3] }));
}

describe('QFIELD_TO_FIBREFLOW vs the extraction registry', () => {
  it('parses both sides — a silent parse failure would make every assertion vacuous', () => {
    // EXACT, not a floor. A regex that silently drops one block (a nested dict inside an
    // entry, reversed key order, single-quoted keys) leaves that project unchecked while
    // a `> 10` guard still passes with three slots to spare.
    expect(registry().length).toBe(REGISTRY_ENTRY_COUNT);
    expect(tsMap().size).toBeGreaterThan(15);
  });

  it('ingests every project that is extracted', () => {
    const map = tsMap();
    const missing = registry()
      .filter((r) => !map.has(r.qf))
      .map((r) => `${r.name} (qf ${r.qf})`);
    expect(missing, 'registered for extraction but absent from QFIELD_TO_FIBREFLOW — '
      + 'its photos will reach qfield_photo_validations and stop').toEqual([]);
  });

  it('agrees with the registry on which FibreFlow project each one belongs to', () => {
    // A wrong-but-well-formed UUID files another project's poles and photos under the
    // wrong project, which no type or lint check can see.
    const map = tsMap();
    const disagree = registry()
      .filter((r) => map.has(r.qf) && map.get(r.qf) !== r.ff)
      .map((r) => `${r.name}: registry ${r.ff} vs map ${map.get(r.qf)}`);
    expect(disagree).toEqual([]);
  });

  it('has no duplicate QFieldCloud keys', () => {
    // A duplicate key in an object literal collapses to last-wins at parse time, so the
    // loaded object can never reveal it — read the source.
    const src = readFileSync(SERVICE, 'utf8');
    const body = src.slice(
      src.indexOf('const QFIELD_TO_FIBREFLOW'),
      src.indexOf('const FIBREFLOW_TO_QFIELD'),
    );
    const keys = [...body.matchAll(new RegExp(`'(${UUID})':`, 'g'))].map((m) => m[1]);
    expect(keys.length).toBe(new Set(keys).size);
  });
});
