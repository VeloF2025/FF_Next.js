import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

export const SAMPLE_UUID = '00000000-0000-0000-0000-000000000000';
export const SAMPLE_DATE = '2026-04-01';
export const SAMPLE_TIMESTAMPTZ = '2026-04-01T08:00:00Z';

export interface SqlTemplate {
  name: string;
  text: string;
  params: unknown[];
}

export function defineLiveSqlGate(name: string, templates: SqlTemplate[]): void {
  const enabled = process.env.SUPABASE_INTEGRATION_TEST === 'true';

  describe.skipIf(!enabled)(name, () => {
    let pool: Pool;

    beforeAll(() => {
      const url = process.env.SUPABASE_INTEGRATION_DB_URL;
      if (!url) throw new Error('SUPABASE_INTEGRATION_DB_URL is required for the live gate');
      pool = new Pool({ connectionString: url });
    });

    afterAll(async () => pool?.end());

    for (const template of templates) {
      it(`EXPLAIN parses ${template.name}`, async () => {
        await expect(pool.query(`EXPLAIN (VERBOSE) ${template.text}`, template.params))
          .resolves.toBeDefined();
      });
    }
  });

  describe.skipIf(enabled)(`${name} disabled`, () => {
    it('does not present static SQL as live database proof', () => {
      expect(enabled).toBe(false);
    });
  });
}
