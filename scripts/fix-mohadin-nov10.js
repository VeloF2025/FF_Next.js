/**
 * Fix Mohadin drops for Nov 10, 2025
 * - Delete DR1854487 (old drop)
 * - Add DR1857113 (09:21)
 * - Add DR1857117 (09:23)
 * Run: node scripts/fix-mohadin-nov10.js
 */

const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL || 'process.env.DATABASE_URL&channel_binding=require');

async function fixMohadinDrops() {
  console.log('🔧 Fixing Mohadin drops for 2025-11-10...\n');

  try {
    // Step 1: Delete DR1854487
    console.log('1️⃣ Deleting DR1854487...');
    const deleteResult = await sql`
      DELETE FROM qa_photo_reviews
      WHERE drop_number = 'DR1854487'
        AND project = 'Mohadin'
      RETURNING drop_number
    `;

    if (deleteResult.length > 0) {
      console.log('   ✅ Deleted DR1854487');
    } else {
      console.log('   ⚠️ DR1854487 not found (already deleted?)');
    }

    // Step 2: Add DR1857113 (09:21)
    console.log('\n2️⃣ Adding DR1857113 (09:21 SAST)...');
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
        'DR1857113',
        'Mohadin',
        'Unknown',
        '2025-11-10',
        '2025-11-10 07:21:00',
        '2025-11-10 07:21:00',
        true,
        false,
        'Manually added - missing from WhatsApp capture',
        false, false, false, false, false, false,
        false, false, false, false, false, false
      )
    `;
    console.log('   ✅ Added DR1857113');

    // Step 3: Add DR1857117 (09:23)
    console.log('\n3️⃣ Adding DR1857117 (09:23 SAST)...');
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
        'DR1857117',
        'Mohadin',
        'Unknown',
        '2025-11-10',
        '2025-11-10 07:23:00',
        '2025-11-10 07:23:00',
        true,
        false,
        'Manually added - missing from WhatsApp capture',
        false, false, false, false, false, false,
        false, false, false, false, false, false
      )
    `;
    console.log('   ✅ Added DR1857117');

    // Step 4: Verify count
    console.log('\n4️⃣ Verifying final count...');
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
      const time = new Date(drop.created_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' });
      console.log(`   ${index + 1}. ${drop.drop_number} (${time})`);
    });

    console.log('\n✅ All operations complete!');

  } catch (error) {
    console.error('❌ Operation failed:', error);
    process.exit(1);
  }
}

fixMohadinDrops();
