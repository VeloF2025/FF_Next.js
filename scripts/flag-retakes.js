/**
 * Flag poles with missing photo steps for field retake.
 * Updates construction_qa_reviews with retake info and generates a summary report.
 */
const { neon } = require('@neondatabase/serverless');

const sql = neon('postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require');

const STEP_NAMES = {
  s1: 'Before Photo',
  s2: 'During Photo',
  s3: 'Depth Photo',
  s4: 'End Plates',
  s5: 'Compaction',
  s6: 'Level Check',
  s7: 'After Photo',
};

async function main() {
  const rows = await sql`
    SELECT
      r.id,
      r.feature_id,
      pr.project_name,
      r.photo_count,
      r.zone_no,
      r.pon_no,
      r.civil_step_01_before_photo as s1,
      r.civil_step_02_during_photo as s2,
      r.civil_step_03_depth_photo as s3,
      r.civil_step_04_end_plates as s4,
      r.civil_step_05_compaction as s5,
      r.civil_step_06_level_check as s6,
      r.civil_step_07_after_photo as s7
    FROM construction_qa_reviews r
    JOIN projects pr ON r.project_id = pr.id
    WHERE r.workflow_status = 'pending'
    ORDER BY pr.project_name, r.feature_id
  `;

  console.log(`Total pending reviews: ${rows.length}\n`);

  const projectSummary = {};
  let flagged = 0;

  for (const r of rows) {
    const gaps = [];
    if (!r.s1 && !r.s2) gaps.push('Before/During');
    if (!r.s3) gaps.push('Depth');
    if (!r.s4) gaps.push('End Plates');
    if (!r.s5) gaps.push('Compaction');
    if (!r.s6) gaps.push('Level Check');
    if (!r.s7) gaps.push('After Photo');

    if (gaps.length === 0) continue;

    // Track per project
    const proj = r.project_name;
    if (!projectSummary[proj]) projectSummary[proj] = { total: 0, byGap: {}, poles: [] };
    projectSummary[proj].total++;
    for (const g of gaps) {
      projectSummary[proj].byGap[g] = (projectSummary[proj].byGap[g] || 0) + 1;
    }
    projectSummary[proj].poles.push({
      featureId: r.feature_id,
      zone: r.zone_no,
      pon: r.pon_no,
      missing: gaps,
      photoCount: Number(r.photo_count),
    });

    // Update review: set workflow_status to 'retake_required' and store missing steps
    await sql`
      UPDATE construction_qa_reviews
      SET workflow_status = 'retake_required',
          qa_decision = 'RETAKE',
          qa_notes = ${`Missing: ${gaps.join(', ')}`},
          updated_at = NOW()
      WHERE id = ${r.id}::uuid
        AND workflow_status = 'pending'
    `;

    // Log activity
    await sql`
      INSERT INTO construction_qa_activity (review_id, event_type, actor, payload)
      VALUES (
        ${r.id}::uuid,
        'retake_flagged',
        'batch-auto-approve',
        ${JSON.stringify({ missing_steps: gaps, photo_count: Number(r.photo_count) })}::jsonb
      )
    `;

    flagged++;
  }

  console.log(`Flagged for retake: ${flagged}\n`);

  // Print summary
  for (const [proj, data] of Object.entries(projectSummary)) {
    console.log(`\n${proj} (${data.total} poles need retakes):`);
    const sorted = Object.entries(data.byGap).sort((a, b) => b[1] - a[1]);
    for (const [gap, cnt] of sorted) {
      const bar = '#'.repeat(Math.min(50, Math.round((cnt / data.total) * 50)));
      console.log(`  ${gap.padEnd(16)}: ${String(cnt).padStart(4)} (${((cnt / data.total) * 100).toFixed(0)}%) ${bar}`);
    }
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
