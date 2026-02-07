/**
 * Add missing DR1857294 to Mohadin drops
 * Run: node scripts/add-dr1857294.js
 */

const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL || 'process.env.DATABASE_URL&channel_binding=require');

async function addMissingDrop() {
  console.log('➕ Adding DR1857294 to Mohadin...\n');

  try {
    // Check if it already exists
    const existing = await sql`
      SELECT drop_number FROM qa_photo_reviews
      WHERE drop_number = 'DR1857294'
        AND project = 'Mohadin'
    `;

    if (existing.length > 0) {
      console.log('⚠️  DR1857294 already exists in database');
      return;
    }

    // Estimate time - between DR1857091 (15:00) and now
    // Let's assume it came around 15:30
    console.log('Adding DR1857294 (estimated 15:30 SAST)...');

    await sql`
      INSERT INTO qa_photo_reviews (
        drop_number,
        project,
        user_name,
        review_date,
        created_at,
        updated_at,
        incomplete,
        completed,
        comment,
        step_01_house_photo,
        step_02_cable_from_pole,
        step_03_cable_entry_outside,
        step_04_cable_entry_inside,
        step_05_wall_for_installation,
        step_06_ont_back_after_install,
        step_07_power_meter_reading,
        step_08_ont_barcode,
        step_09_ups_serial,
        step_10_final_installation,
        step_11_green_lights,
        step_12_customer_signature
      ) VALUES (
        'DR1857294',
        'Mohadin',
        'Unknown',
        '2025-11-10',
        '2025-11-10 13:30:00',
        '2025-11-10 13:30:00',
        true,
        false,
        'Manually added - missed during bridge restart',
        false, false, false, false, false, false,
        false, false, false, false, false, false
      )
    `;

    console.log('✅ Added DR1857294');

    // Verify final count
    const finalCount = await sql`
      SELECT COUNT(*) as count
      FROM qa_photo_reviews
      WHERE project = 'Mohadin'
        AND created_at >= '2025-11-10 00:00:00'
        AND created_at < '2025-11-11 00:00:00'
    `;

    console.log(`\n✅ Final count: ${finalCount[0].count} drops for Mohadin today`);

    // List all drops
    const allDrops = await sql`
      SELECT drop_number, created_at
      FROM qa_photo_reviews
      WHERE project = 'Mohadin'
        AND created_at >= '2025-11-10 00:00:00'
        AND created_at < '2025-11-11 00:00:00'
      ORDER BY created_at ASC
    `;

    console.log('\n📋 Final list:');
    allDrops.forEach((drop, index) => {
      const time = new Date(drop.created_at).toLocaleTimeString('en-ZA', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Africa/Johannesburg'
      });
      console.log(`   ${index + 1}. ${drop.drop_number} (${time})`);
    });

    console.log('\n✅ Operation complete!');

  } catch (error) {
    console.error('❌ Operation failed:', error);
    process.exit(1);
  }
}

addMissingDrop();
