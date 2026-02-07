// Script to add DR1857288 manually - Drop from manually submitted photo
// Date: November 12, 2025
// Issue: Drop posted but not captured by monitor (needs investigation)

const { neon } = require('@neondatabase/serverless');
const DATABASE_URL = 'process.env.DATABASE_URL';

const sql = neon(DATABASE_URL);

async function addDrop() {
  try {
    console.log('Adding DR1857288...');

    const result = await sql`
      INSERT INTO qa_photo_reviews (
        drop_number,
        project,
        submitted_by,
        user_name,
        created_at,
        updated_at,
        whatsapp_message_date,
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
        step_12_customer_signature,
        completed_photos,
        outstanding_photos,
        outstanding_photos_loaded_to_1map,
        completed,
        incomplete,
        resubmitted,
        feedback_sent,
        comment
      ) VALUES (
        'DR1857288',
        'Mohadin',
        NULL,  -- No sender info (manually added)
        'Unknown',
        NOW(),
        NOW(),
        NOW(),  -- Use current time as message date
        false, false, false, false, false, false,
        false, false, false, false, false, false,
        0,
        12,
        false,
        false,
        true,
        false,
        NULL,
        'Manually added - not captured by monitor'
      )
      ON CONFLICT (drop_number) DO NOTHING
      RETURNING drop_number;
    `;

    if (result.length > 0) {
      console.log('✅ Successfully added DR1857288');
    } else {
      console.log('⚠️  DR1857288 already exists in database');
    }

  } catch (error) {
    console.error('❌ Error adding drop:', error);
    process.exit(1);
  }
}

addDrop();
