/**
 * H&S equipment-checklist category sync ratchet (migration 462).
 *
 * hs_checklist_templates.category / hs_checklist_items.category are
 * unconstrained VARCHAR(100) -- there's no DB CHECK constraint to keep them
 * in sync with the TS `ChecklistCategory` union, unlike the appointment-letter
 * CHECK (see appointmentTypeSync.test.ts). That makes it easy for the seed
 * migration and the TS types to silently drift: a template inserted with a
 * category the UI doesn't know a label for renders the raw enum value
 * instead (CHECKLIST_CATEGORIES[cat]?.label || cat, per AuditWizard.tsx /
 * checklists/new.tsx), and a TS category with no seeded template is dead code.
 *
 * This is a static-contract ratchet (mirrors dateTextCast.test.ts /
 * appointmentTypeSync.test.ts): reads the migration file and the types file
 * as text and asserts the 7 new equipment-checklist categories are declared
 * in exactly the same set in both places.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = 'scripts/migrations/sql/462_hs_equipment_checklist_seed.sql';
const TYPES_PATH = 'src/modules/health-safety/types/checklist.types.ts';

const EXPECTED_CATEGORIES = [
  'ladder',
  'hand_tools',
  'fire_equipment',
  'road_cutter',
  'compactor',
  'barricading',
  'traffic_signage',
] as const;

function readProjectFile(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

function migrationTemplateCategories(migrationSrc: string): string[] {
  const match = migrationSrc.match(/INSERT INTO hs_checklist_templates[\s\S]*?FROM \(VALUES([\s\S]*?)\) AS v\(name, category, description\)/);
  if (!match) throw new Error('Could not find the hs_checklist_templates seed VALUES block');
  // Each row is ('Name', 'category', 'description') -- category is always the 2nd quoted field.
  const rows = Array.from(match[1].matchAll(/\('[^']*',\s*'([a-z_]+)',/g));
  return rows.map((m) => m[1]);
}

function migrationItemCategories(migrationSrc: string): string[] {
  const match = migrationSrc.match(/INSERT INTO hs_checklist_items[\s\S]*?VALUES([\s\S]*?)ON CONFLICT/);
  if (!match) throw new Error('Could not find the hs_checklist_items seed VALUES block');
  // Rows: (v_x_id, 'item text', 'category', 'severity', ...) -- category is the 3rd field.
  const rows = Array.from(match[1].matchAll(/\(v_\w+_id,\s*'[^']*',\s*'([a-z_]+)',/g));
  return rows.map((m) => m[1]);
}

function tsUnionValues(typesSrc: string): string[] {
  const match = typesSrc.match(/export type ChecklistCategory =([\s\S]*?);/);
  if (!match) throw new Error('Could not find the ChecklistCategory union declaration');
  return Array.from(match[1].matchAll(/'([a-z_]+)'/g)).map((m) => m[1]);
}

function tsCategoryRecordKeys(typesSrc: string): string[] {
  const match = typesSrc.match(/export const CHECKLIST_CATEGORIES[\s\S]*?=\s*\{([\s\S]*?)\};/);
  if (!match) throw new Error('Could not find the CHECKLIST_CATEGORIES record declaration');
  return Array.from(match[1].matchAll(/value:\s*'([a-z_]+)'/g)).map((m) => m[1]);
}

describe('hs_checklist_templates/items categories: migration 462 <-> ChecklistCategory stay in sync', () => {
  const migrationSrc = readProjectFile(MIGRATION_PATH);
  const typesSrc = readProjectFile(TYPES_PATH);

  it('migration 462 seeds exactly the 7 expected template categories, no duplicates', () => {
    const cats = migrationTemplateCategories(migrationSrc);
    expect(new Set(cats)).toEqual(new Set(EXPECTED_CATEGORIES));
    expect(cats).toHaveLength(EXPECTED_CATEGORIES.length);
  });

  it('every seeded template has exactly 5 checklist items in the same 7 categories', () => {
    const itemCats = migrationItemCategories(migrationSrc);
    expect(new Set(itemCats)).toEqual(new Set(EXPECTED_CATEGORIES));
    for (const cat of EXPECTED_CATEGORIES) {
      expect(itemCats.filter((c) => c === cat)).toHaveLength(5);
    }
  });

  it('ChecklistCategory union includes all 7 new categories', () => {
    const union = tsUnionValues(typesSrc);
    for (const cat of EXPECTED_CATEGORIES) {
      expect(union).toContain(cat);
    }
  });

  it('CHECKLIST_CATEGORIES has a label entry for all 7 new categories', () => {
    const keys = tsCategoryRecordKeys(typesSrc);
    for (const cat of EXPECTED_CATEGORIES) {
      expect(keys).toContain(cat);
    }
  });

  it('all 7 new templates are seeded inactive (is_active/is_default = false) -- see rec #5 activation decision', () => {
    const match = migrationSrc.match(/SELECT v\.name, v\.category, v\.description, (\w+), (\w+)\s*\nFROM \(VALUES/);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe('false');
    expect(match?.[2]).toBe('false');
  });
});
