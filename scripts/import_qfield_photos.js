require('dotenv').config({ path: '.env.local' });
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');

const sql = neon(process.env.DATABASE_URL);

async function importPhotos() {
  const data = fs.readFileSync('/tmp/qfield_photos.csv', 'utf8');
  const lines = data.trim().split('\n').filter(l => l.trim());

  console.log(`Importing ${lines.length} photos...`);

  // First, get existing photo_keys to avoid duplicates
  const existing = await sql`SELECT photo_key FROM qfield_photo_validations`;
  const existingKeys = new Set(existing.map(r => r.photo_key));
  console.log(`Found ${existingKeys.size} existing records`);

  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split('|');
    const [project_id, project_name, photo_key, filename] = parts;

    if (!photo_key || existingKeys.has(photo_key)) {
      skipped++;
      continue;
    }

    // Determine work type from project name
    let work_type = 'pole_installation';
    if (project_name.toLowerCase().includes('site')) work_type = 'activation';
    else if (project_name.toLowerCase().includes('cable')) work_type = 'cable_stringing';

    // Extract feature_id from filename
    const feature_id = filename?.split('/').pop()?.replace(/\.(jpg|jpeg|png)$/i, '') || null;

    try {
      await sql`
        INSERT INTO qfield_photo_validations (
          project_id, photo_key, work_type, feature_id, workflow_status, created_at
        ) VALUES (
          ${project_id}::uuid, ${photo_key}, ${work_type}, ${feature_id}, 'pending', NOW()
        )
      `;
      imported++;
      existingKeys.add(photo_key);
    } catch (err) {
      console.error(`Error at ${i}:`, err.message.slice(0, 100));
      skipped++;
    }

    if ((i + 1) % 500 === 0) {
      console.log(`Progress: ${i + 1}/${lines.length} (imported: ${imported})`);
    }
  }

  console.log(`Done! Imported: ${imported}, Skipped: ${skipped}`);

  const count = await sql`SELECT COUNT(*) as total FROM qfield_photo_validations`;
  console.log(`Total records in table: ${count[0].total}`);
}

importPhotos().catch(console.error);
