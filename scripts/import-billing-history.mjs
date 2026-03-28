/**
 * One-time script to import historical FiberTime billing data from CSV
 * Source: /tmp/ft-invoicing/billing_summary.csv (parsed from 75 payment summary PDFs)
 *
 * Usage: node scripts/import-billing-history.mjs
 */

import { readFileSync } from 'fs';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

const CSV_PATH = '/tmp/ft-invoicing/billing_summary.csv';

// Month name → number
const MONTHS = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
};

function parseDateString(dateStr) {
  // "27 July 2025" → "2025-07-27"
  const parts = dateStr.trim().split(/\s+/);
  if (parts.length !== 3) throw new Error(`Cannot parse date: ${dateStr}`);
  const day = parts[0].padStart(2, '0');
  const month = MONTHS[parts[1].toLowerCase()];
  if (!month) throw new Error(`Unknown month: ${parts[1]}`);
  const year = parts[2];
  return `${year}-${month}-${day}`;
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

  try {
    // Read and parse CSV
    const csv = readFileSync(CSV_PATH, 'utf-8');
    const lines = csv.trim().split('\n');
    const header = lines[0].split(',');
    console.log(`CSV has ${lines.length - 1} rows, columns: ${header.join(', ')}`);

    // Fetch price_per_drop per project
    const poResult = await pool.query(`
      SELECT p.project_name, cpo.price_per_drop
      FROM client_purchase_orders cpo
      JOIN projects p ON p.id = cpo.project_id
      WHERE cpo.status = 'active'
      ORDER BY p.project_name, cpo.created_at DESC
    `);
    const priceMap = {};
    for (const row of poResult.rows) {
      if (!priceMap[row.project_name]) {
        priceMap[row.project_name] = parseFloat(row.price_per_drop);
      }
    }
    console.log('Price per drop:', priceMap);

    // Default price if not found
    const DEFAULT_PRICE = 2700;
    const TAX_RATE = 15;

    let inserted = 0;
    let updated = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 10) continue;

      const weekEnding = parseDateString(cols[0]);
      const project = cols[1];
      const totalOnts = parseInt(cols[2]) || 0;
      const previouslyInvoiced = parseInt(cols[3]) || 0;
      const claimable = parseInt(cols[4]) || 0;
      const note1Count = parseInt(cols[5]) || 0;
      const note2Count = parseInt(cols[6]) || 0;
      // CSV has note4 at index 7, note5 at index 8 (no note3 column)
      const note4Count = parseInt(cols[7]) || 0;
      const note5Count = parseInt(cols[8]) || 0;
      const preProvisionsCount = parseInt(cols[9]) || 0;
      const totalClaimable = parseInt(cols[10]) || 0;

      const pricePerDrop = priceMap[project] || DEFAULT_PRICE;
      const invoiceSubtotal = totalClaimable * pricePerDrop;
      const invoiceTotal = invoiceSubtotal * (1 + TAX_RATE / 100);

      const result = await pool.query(`
        INSERT INTO ft_weekly_billing (
          week_ending, project,
          ft_total_onts, ft_previously_invoiced, ft_claimable,
          ft_note1_count, ft_note2_count, ft_note3_count, ft_note4_count, ft_note5_count,
          ft_pre_provisions_count, ft_total_claimable,
          price_per_drop, tax_rate, invoice_subtotal, invoice_total,
          pdf_filename, uploaded_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (week_ending, project)
        DO UPDATE SET
          ft_total_onts = EXCLUDED.ft_total_onts,
          ft_previously_invoiced = EXCLUDED.ft_previously_invoiced,
          ft_claimable = EXCLUDED.ft_claimable,
          ft_note1_count = EXCLUDED.ft_note1_count,
          ft_note2_count = EXCLUDED.ft_note2_count,
          ft_note3_count = EXCLUDED.ft_note3_count,
          ft_note4_count = EXCLUDED.ft_note4_count,
          ft_note5_count = EXCLUDED.ft_note5_count,
          ft_pre_provisions_count = EXCLUDED.ft_pre_provisions_count,
          ft_total_claimable = EXCLUDED.ft_total_claimable,
          price_per_drop = EXCLUDED.price_per_drop,
          invoice_subtotal = EXCLUDED.invoice_subtotal,
          invoice_total = EXCLUDED.invoice_total,
          updated_at = NOW()
        RETURNING (xmax = 0) AS was_inserted
      `, [
        weekEnding, project,
        totalOnts, previouslyInvoiced, claimable,
        note1Count, note2Count, 0 /* note3 not in CSV */, note4Count, note5Count,
        preProvisionsCount, totalClaimable,
        pricePerDrop, TAX_RATE, invoiceSubtotal, invoiceTotal,
        'historical-csv-import', 'system'
      ]);

      if (result.rows[0]?.was_inserted) {
        inserted++;
      } else {
        updated++;
      }
    }

    console.log(`Done. Inserted: ${inserted}, Updated: ${updated}, Total: ${inserted + updated}`);

    // Verify
    const countResult = await pool.query('SELECT COUNT(*) FROM ft_weekly_billing');
    console.log(`Total rows in ft_weekly_billing: ${countResult.rows[0].count}`);

    const projectCounts = await pool.query(`
      SELECT project, COUNT(*) as weeks, MIN(week_ending) as first_week, MAX(week_ending) as last_week
      FROM ft_weekly_billing GROUP BY project ORDER BY project
    `);
    console.log('\nPer-project summary:');
    for (const row of projectCounts.rows) {
      console.log(`  ${row.project}: ${row.weeks} weeks (${row.first_week} → ${row.last_week})`);
    }

  } catch (error) {
    console.error('Import failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
