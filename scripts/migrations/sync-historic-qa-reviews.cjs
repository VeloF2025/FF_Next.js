/**
 * Migration: Sync Historic QA Reviews into Unified Reviews
 *
 * Purpose: Import manual QA review data from sharepoint_lawley_qa and
 * sharepoint_mohadin_qa into dr_photo_unified_reviews
 *
 * Step Mapping (12-step historic → 10-step current):
 *   step_1_property_frontage        → step_01_house_photo
 *   step_2_location_on_wall         → step_05_wall
 *   step_3_outside_cable_span       → step_02_cable_from_pole
 *   step_4_home_entry_outside       → step_03_entry_outside
 *   step_5_home_entry_inside        → step_04_entry_inside
 *   step_6_fibre_entry_to_ont       → step_06_ont_back
 *   step_7_work_area_completion     → step_08_final_installation
 *   step_8_ont_barcode              → (noted in metadata, not a photo step)
 *   step_9_mini_ups_serial          → (noted in metadata, not a photo step)
 *   step_10_powermeter              → step_07_power_meter
 *   step_11_active_broadband_light  → step_09_green_lights
 *   step_12_customer_signature      → step_10_signature
 *
 * Data synced:
 * - Step approvals (boolean)
 * - Comments → qa_decision_notes
 * - User name → reviewed_by
 * - Date → reviewed_at
 * - human_review_status = 'historic_import'
 * - Metadata in human_qa_overrides
 *
 * Run: node scripts/migrations/sync-historic-qa-reviews.cjs
 */

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL ||
  'process.env.DATABASE_URL';

const sql = neon(DATABASE_URL);

// Dry run mode - set to false to actually write data
const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--execute');

async function main() {
  console.log('='.repeat(60));
  console.log('Historic QA Review Sync Migration');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (use --execute to apply)' : 'EXECUTING'}`);
  console.log('');

  // Step 1: Get all historic reviews from both tables
  console.log('Step 1: Fetching historic reviews...');

  const lawleyReviews = await sql`
    SELECT
      drop_number,
      date,
      user_name,
      comment,
      step_1_property_frontage,
      step_2_location_on_wall,
      step_3_outside_cable_span,
      step_4_home_entry_outside,
      step_5_home_entry_inside,
      step_6_fibre_entry_to_ont,
      step_7_work_area_completion,
      step_8_ont_barcode,
      step_9_mini_ups_serial,
      step_10_powermeter_before_activation,
      step_11_active_broadband_light,
      step_12_customer_signature,
      completed_photos,
      outstanding_photos,
      raw_data,
      'Lawley' as project_source
    FROM sharepoint_lawley_qa
  `;

  const mohadinReviews = await sql`
    SELECT
      drop_number,
      date,
      user_name,
      comment,
      step_1_property_frontage,
      step_2_location_on_wall,
      step_3_outside_cable_span,
      step_4_home_entry_outside,
      step_5_home_entry_inside,
      step_6_fibre_entry_to_ont,
      step_7_work_area_completion,
      step_8_ont_barcode,
      step_9_mini_ups_serial,
      step_10_powermeter_before_activation,
      step_11_active_broadband_light,
      step_12_customer_signature,
      completed_photos,
      outstanding_photos,
      raw_data,
      'Mohadin' as project_source
    FROM sharepoint_mohadin_qa
  `;

  const allHistoric = [...lawleyReviews, ...mohadinReviews];
  console.log(`  Found ${lawleyReviews.length} Lawley reviews`);
  console.log(`  Found ${mohadinReviews.length} Mohadin reviews`);
  console.log(`  Total: ${allHistoric.length} historic reviews`);
  console.log('');

  // Step 2: Get existing unified reviews
  console.log('Step 2: Checking existing unified reviews...');

  const existingDrops = await sql`
    SELECT drop_number, human_review_status, reviewed_by
    FROM dr_photo_unified_reviews
  `;

  const existingMap = new Map(
    existingDrops.map(r => [r.drop_number, r])
  );

  console.log(`  Found ${existingDrops.length} unified reviews`);
  console.log('');

  // Step 3: Process and prepare updates
  console.log('Step 3: Processing historic reviews...');

  const stats = {
    matched: 0,
    notFound: 0,
    alreadySynced: 0,
    toUpdate: 0,
    withComments: 0,
  };

  const updates = [];
  const notFound = [];

  for (const historic of allHistoric) {
    const existing = existingMap.get(historic.drop_number);

    if (!existing) {
      stats.notFound++;
      notFound.push(historic.drop_number);
      continue;
    }

    stats.matched++;

    // Check if already synced
    if (existing.human_review_status === 'historic_import') {
      stats.alreadySynced++;
      continue;
    }

    stats.toUpdate++;
    if (historic.comment) {
      stats.withComments++;
    }

    // Map 12-step to 10-step
    const mappedSteps = {
      step_01_house_photo: historic.step_1_property_frontage,
      step_02_cable_from_pole: historic.step_3_outside_cable_span,
      step_03_entry_outside: historic.step_4_home_entry_outside,
      step_04_entry_inside: historic.step_5_home_entry_inside,
      step_05_wall: historic.step_2_location_on_wall,
      step_06_ont_back: historic.step_6_fibre_entry_to_ont,
      step_07_power_meter: historic.step_10_powermeter_before_activation,
      step_08_final_installation: historic.step_7_work_area_completion,
      step_09_green_lights: historic.step_11_active_broadband_light,
      step_10_signature: historic.step_12_customer_signature,
    };

    // Build metadata for human_qa_overrides
    const metadata = {
      source: 'historic_manual_qa',
      imported_at: new Date().toISOString(),
      original_project: historic.project_source,
      original_user: historic.user_name,
      original_date: historic.date,
      original_12_step: {
        step_8_ont_barcode: historic.step_8_ont_barcode,
        step_9_mini_ups_serial: historic.step_9_mini_ups_serial,
      },
      completed_photos: historic.completed_photos,
      outstanding_photos: historic.outstanding_photos,
    };

    updates.push({
      drop_number: historic.drop_number,
      ...mappedSteps,
      qa_decision_notes: historic.comment || null,
      reviewed_by: historic.user_name || 'Historic Import',
      reviewed_at: historic.date || new Date().toISOString(),
      human_review_status: 'historic_import',
      human_review_completed_at: historic.date || new Date().toISOString(),
      human_qa_overrides: metadata,
    });
  }

  console.log(`  Matched: ${stats.matched}`);
  console.log(`  Not found in unified: ${stats.notFound}`);
  console.log(`  Already synced: ${stats.alreadySynced}`);
  console.log(`  To update: ${stats.toUpdate}`);
  console.log(`  With comments: ${stats.withComments}`);
  console.log('');

  if (notFound.length > 0 && notFound.length <= 20) {
    console.log('  Not found drop numbers:', notFound.slice(0, 20).join(', '));
    console.log('');
  }

  // Step 4: Apply updates
  if (DRY_RUN) {
    console.log('Step 4: DRY RUN - No changes applied');
    console.log('');
    console.log('Sample update (first record):');
    if (updates.length > 0) {
      console.log(JSON.stringify(updates[0], null, 2));
    }
    console.log('');
    console.log('To execute, run: node scripts/migrations/sync-historic-qa-reviews.cjs --execute');
  } else {
    console.log('Step 4: Applying updates...');

    let successCount = 0;
    let errorCount = 0;

    for (const update of updates) {
      try {
        await sql`
          UPDATE dr_photo_unified_reviews
          SET
            step_01_house_photo = COALESCE(${update.step_01_house_photo}, step_01_house_photo),
            step_02_cable_from_pole = COALESCE(${update.step_02_cable_from_pole}, step_02_cable_from_pole),
            step_03_entry_outside = COALESCE(${update.step_03_entry_outside}, step_03_entry_outside),
            step_04_entry_inside = COALESCE(${update.step_04_entry_inside}, step_04_entry_inside),
            step_05_wall = COALESCE(${update.step_05_wall}, step_05_wall),
            step_06_ont_back = COALESCE(${update.step_06_ont_back}, step_06_ont_back),
            step_07_power_meter = COALESCE(${update.step_07_power_meter}, step_07_power_meter),
            step_08_final_installation = COALESCE(${update.step_08_final_installation}, step_08_final_installation),
            step_09_green_lights = COALESCE(${update.step_09_green_lights}, step_09_green_lights),
            step_10_signature = COALESCE(${update.step_10_signature}, step_10_signature),
            qa_decision_notes = COALESCE(${update.qa_decision_notes}, qa_decision_notes),
            reviewed_by = COALESCE(${update.reviewed_by}, reviewed_by),
            reviewed_at = COALESCE(${update.reviewed_at}::TIMESTAMPTZ, reviewed_at),
            human_review_status = ${update.human_review_status},
            human_review_completed_at = COALESCE(${update.human_review_completed_at}::TIMESTAMPTZ, human_review_completed_at),
            human_qa_overrides = ${JSON.stringify(update.human_qa_overrides)}::JSONB,
            updated_at = NOW()
          WHERE drop_number = ${update.drop_number}
        `;
        successCount++;

        if (successCount % 100 === 0) {
          console.log(`  Processed ${successCount}/${updates.length}...`);
        }
      } catch (error) {
        errorCount++;
        console.error(`  Error updating ${update.drop_number}:`, error.message);
      }
    }

    console.log('');
    console.log(`  Successfully updated: ${successCount}`);
    console.log(`  Errors: ${errorCount}`);

    // Step 5: Add activity log entries for historic reviews
    console.log('');
    console.log('Step 5: Adding activity log entries for timeline visibility...');

    let activityCount = 0;
    for (const update of updates) {
      try {
        // Add "human_review_completed" entry so it shows in activity timeline
        await sql`
          INSERT INTO dr_activity_log (drop_number, event_type, event_data, actor, created_at)
          VALUES (
            ${update.drop_number},
            'human_review_completed',
            ${JSON.stringify({
              source: 'historic_manual_qa',
              reviewer: update.reviewed_by,
              comment: update.qa_decision_notes,
              stepsApproved: Object.entries({
                step_01: update.step_01_house_photo,
                step_02: update.step_02_cable_from_pole,
                step_03: update.step_03_entry_outside,
                step_04: update.step_04_entry_inside,
                step_05: update.step_05_wall,
                step_06: update.step_06_ont_back,
                step_07: update.step_07_power_meter,
                step_08: update.step_08_final_installation,
                step_09: update.step_09_green_lights,
                step_10: update.step_10_signature,
              }).filter(([_, v]) => v === true).map(([k]) => k),
              importedAt: new Date().toISOString(),
            })}::jsonb,
            ${update.reviewed_by || 'Historic Import'},
            ${update.reviewed_at}::timestamptz
          )
          ON CONFLICT DO NOTHING
        `;
        activityCount++;

        if (activityCount % 100 === 0) {
          console.log(`  Activity entries: ${activityCount}/${updates.length}...`);
        }
      } catch (error) {
        // Ignore duplicate errors
        if (!error.message.includes('duplicate')) {
          console.log(`  Activity log error for ${update.drop_number}: ${error.message}`);
        }
      }
    }
    console.log(`  Added ${activityCount} activity log entries`);
  }

  // Summary
  console.log('');
  console.log('='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`Total historic reviews: ${allHistoric.length}`);
  console.log(`Matched to unified: ${stats.matched}`);
  console.log(`Updates applied: ${DRY_RUN ? '0 (dry run)' : stats.toUpdate}`);
  console.log(`Comments preserved: ${stats.withComments}`);
  console.log('');
}

main().catch(console.error);
