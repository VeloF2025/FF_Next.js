import { neon } from '@neondatabase/serverless';

const sql = neon('postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require');

// 1. Add columns
await sql`ALTER TABLE gl_journal_lines ADD COLUMN IF NOT EXISTS vat_type TEXT`;
console.log('1. Added vat_type to gl_journal_lines');

await sql`ALTER TABLE supplier_invoice_items ADD COLUMN IF NOT EXISTS vat_classification TEXT`;
console.log('2. Added vat_classification to supplier_invoice_items');

try {
  await sql`ALTER TABLE vat_adjustments ADD COLUMN IF NOT EXISTS adjustment_category TEXT DEFAULT 'other'`;
  console.log('3. Added adjustment_category to vat_adjustments');
} catch(e) { console.log('3.', e.message); }

// 2. Default existing data
await sql`UPDATE gl_journal_lines SET vat_type = 'standard' WHERE vat_type IS NULL AND gl_account_id IN (SELECT id FROM gl_accounts WHERE account_code IN ('1140','2120'))`;
console.log('4. Defaulted existing VAT journal lines to standard');

await sql`UPDATE supplier_invoice_items SET vat_classification = CASE WHEN tax_rate > 0 THEN 'standard' ELSE 'zero_rated' END WHERE vat_classification IS NULL`;
console.log('5. Defaulted supplier invoice items');

// 3. Indexes
try {
  await sql`CREATE INDEX IF NOT EXISTS idx_journal_lines_vat_type ON gl_journal_lines (vat_type) WHERE vat_type IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_journal_lines_vat_reporting ON gl_journal_lines (gl_account_id, vat_type) WHERE vat_type IS NOT NULL`;
  console.log('6. Created indexes');
} catch(e) { console.log('6.', e.message); }

// 4. Verify
const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'gl_journal_lines' AND column_name = 'vat_type'`;
console.log('VERIFY: vat_type column exists =', cols.length > 0);

const dist = await sql`SELECT vat_type, COUNT(*) as cnt FROM gl_journal_lines WHERE vat_type IS NOT NULL GROUP BY vat_type`;
console.log('VAT type distribution:', JSON.stringify(dist));

console.log('Migration 210 complete!');
