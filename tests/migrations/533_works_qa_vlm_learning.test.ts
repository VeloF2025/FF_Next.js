import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(process.cwd(), 'scripts/migrations/sql/533_works_qa_vlm_learning.sql'),
  'utf8',
);

describe('migration 533 Works QA VLM learning contract', () => {
  it('keeps civil and optical correction lanes isolated', () => {
    expect(sql).toContain("WHEN category LIKE 'civil%' THEN 'works_qa_civil'");
    expect(sql).toContain("WHEN category LIKE 'dome%' OR category LIKE 'main_joint%' THEN 'works_qa_optical'");
  });

  it('mirrors only Works QA correction examples idempotently', () => {
    expect(sql).toContain("IF NEW.workflow_type <> 'works_qa'");
    expect(sql).toContain("source_table = 'qa_correction_examples'");
    expect(sql).toMatch(/ON CONFLICT \(source_table, source_id, analysis_type\)[\s\S]*DO UPDATE SET/);
  });

  it('backfills prior Works QA corrections through the same trigger path', () => {
    expect(sql).toMatch(/UPDATE qa_correction_examples[\s\S]*WHERE workflow_type = 'works_qa'/);
  });
});
