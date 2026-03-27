/**
 * Run reconciliation on all ft_weekly_billing rows.
 * Computes our OES counts vs FT numbers and updates variance.
 * Does NOT update oes_activations.payment_status — that's a separate step.
 *
 * Usage: node scripts/reconcile-all-weeks.mjs
 */

import pg from 'pg';

const DATABASE_URL = 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

  try {
    // Get all billing weeks sorted chronologically
    const weeks = await pool.query(`
      SELECT id, week_ending, project, ft_total_onts, ft_claimable, ft_total_claimable,
             ft_note1_count, ft_note2_count, ft_note3_count, ft_note4_count, ft_note5_count,
             ft_pre_provisions_count, reconciliation_status
      FROM ft_weekly_billing
      ORDER BY week_ending ASC, project ASC
    `);

    console.log(`Reconciling ${weeks.rows.length} billing weeks...\n`);

    let reconciled = 0;
    let skipped = 0;

    for (const week of weeks.rows) {
      // Count our OES activations for this project up to week_ending (cumulative)
      const oesResult = await pool.query(`
        SELECT COUNT(*)::int as total
        FROM oes_activations oa
        JOIN drops d ON d.id = oa.drop_id
        JOIN projects p ON p.id = d.project_id
        WHERE p.project_name ILIKE $1
          AND oa.activation_date <= $2
      `, [week.project, week.week_ending]);

      const ourTotal = oesResult.rows[0]?.total || 0;

      // Sum previously invoiced from prior weeks
      const prevResult = await pool.query(`
        SELECT COALESCE(SUM(ft_total_claimable), 0)::int as prev_invoiced
        FROM ft_weekly_billing
        WHERE project ILIKE $1 AND week_ending < $2
      `, [week.project, week.week_ending]);

      const prevInvoiced = prevResult.rows[0]?.prev_invoiced || 0;
      const ourClaimable = ourTotal - prevInvoiced;

      // Count pre-provisions
      const ppResult = await pool.query(`
        SELECT COUNT(*)::int as pp_count
        FROM oes_pp_data
        WHERE project ILIKE $1 AND resolution_status != 'activated'
      `, [week.project]);

      const ourPP = ppResult.rows[0]?.pp_count || 0;

      // Compute variance
      const varianceClaimable = ourClaimable - week.ft_claimable;
      const varianceTotalOnts = ourTotal - week.ft_total_onts;

      // Update
      await pool.query(`
        UPDATE ft_weekly_billing SET
          our_total_activations = $1,
          our_claimable = $2,
          our_pre_provisions_count = $3,
          variance_claimable = $4,
          variance_total_onts = $5,
          reconciliation_status = 'reconciled',
          reconciled_at = NOW(),
          reconciled_by = 'system-bulk',
          updated_at = NOW()
        WHERE id = $6
      `, [ourTotal, ourClaimable, ourPP, varianceClaimable, varianceTotalOnts, week.id]);

      const marker = varianceClaimable === 0 ? '✓' : varianceClaimable > 0 ? `+${varianceClaimable}` : `${varianceClaimable}`;
      console.log(`  ${week.week_ending} ${week.project.padEnd(10)} FT:${week.ft_claimable} Our:${ourClaimable} Var:${marker}`);
      reconciled++;
    }

    console.log(`\nReconciled: ${reconciled}, Skipped: ${skipped}`);

    // Summary
    const summary = await pool.query(`
      SELECT project,
        COUNT(*) as weeks,
        SUM(ft_total_claimable) as ft_total_paid,
        SUM(our_claimable) as our_total_claimable,
        SUM(variance_claimable) as total_variance
      FROM ft_weekly_billing
      GROUP BY project ORDER BY project
    `);
    console.log('\nReconciliation summary:');
    for (const row of summary.rows) {
      console.log(`  ${row.project}: ${row.weeks} weeks, FT paid ${row.ft_total_paid}, Our claimable ${row.our_total_claimable}, Variance ${row.total_variance}`);
    }

  } catch (error) {
    console.error('Reconciliation failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
