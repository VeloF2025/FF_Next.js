require('dotenv').config({ path: '.env.local' });
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');

const sql = neon(process.env.DATABASE_URL);

async function updateMappings() {
  // Load mappings from CSV
  const data = fs.readFileSync('/tmp/photo_pole_mapping.csv', 'utf8');
  const lines = data.trim().split('\n').filter(l => l.trim());

  console.log(`Loaded ${lines.length} mappings`);

  // Build mapping dictionary: feature_id (from filename) -> pole_number
  const mappings = {};
  for (const line of lines) {
    const [feature_id, pole_number, photo_type] = line.split('|');
    if (feature_id && pole_number) {
      mappings[feature_id.toLowerCase()] = { pole_number, photo_type };
    }
  }

  console.log(`Parsed ${Object.keys(mappings).length} unique feature_ids`);

  // Get all photos that need updating
  const photos = await sql`
    SELECT id, feature_id
    FROM qfield_photo_validations
    WHERE feature_id IS NOT NULL
  `;

  console.log(`Found ${photos.length} photos with feature_id`);

  let updated = 0;
  let notFound = 0;

  for (const photo of photos) {
    const featureId = photo.feature_id.toLowerCase();
    const mapping = mappings[featureId];

    if (mapping) {
      // Update with pole_number
      await sql`
        UPDATE qfield_photo_validations
        SET feature_id = ${mapping.pole_number},
            feature_type = ${mapping.photo_type}
        WHERE id = ${photo.id}
      `;
      updated++;
    } else {
      notFound++;
    }

    if ((updated + notFound) % 500 === 0) {
      console.log(`Progress: ${updated + notFound}/${photos.length} (updated: ${updated})`);
    }
  }

  console.log(`\nDone! Updated: ${updated}, Not found: ${notFound}`);

  // Show sample results
  const sample = await sql`
    SELECT feature_id, feature_type, photo_key
    FROM qfield_photo_validations
    WHERE feature_type IS NOT NULL
    LIMIT 5
  `;
  console.log('\nSample results:', sample);
}

updateMappings().catch(console.error);
