const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

const BOSS_API = 'http://100.96.203.105:8003';

async function syncAll() {
  let totalUpdated = 0;
  let batch = 1;

  while (true) {
    const drsResult = await pool.query(`
      SELECT DISTINCT qpr.drop_number
      FROM qa_photo_reviews qpr
      LEFT JOIN drops d ON qpr.drop_number = d.drop_number
      WHERE qpr.drop_number IS NOT NULL
        AND (d.installed_by_name IS NULL OR d.installed_by_name = '' OR d.id IS NULL)
      LIMIT 200
    `);

    if (drsResult.rows.length === 0) break;

    let updated = 0;
    for (const dr of drsResult.rows) {
      try {
        const response = await fetch(`${BOSS_API}/api/record/${dr.drop_number}`);
        if (!response.ok) continue;
        const data = await response.json();
        if (!data.installer_name || !data.installer_name.trim()) continue;
        const r = await pool.query(
          'UPDATE drops SET installed_by_name = $1 WHERE drop_number = $2',
          [data.installer_name.trim(), dr.drop_number]
        );
        if (r.rowCount > 0) updated++;
      } catch (e) {
        // Skip errors
      }
    }

    totalUpdated += updated;
    console.log(`Batch ${batch++}: ${updated} updated of ${drsResult.rows.length} (total: ${totalUpdated})`);

    if (updated === 0 || batch > 10) break;
    await new Promise(r => setTimeout(r, 100));
  }

  // Final stats
  const stats = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE installed_by_name IS NOT NULL AND installed_by_name != '') as has_installer,
      COUNT(*) as total
    FROM drops
    WHERE drop_number IS NOT NULL
  `);

  console.log('\nFinal stats:', stats.rows[0]);

  // Top installers
  const top = await pool.query(`
    SELECT installed_by_name, COUNT(*) as count
    FROM drops
    WHERE installed_by_name IS NOT NULL AND installed_by_name != ''
    GROUP BY installed_by_name
    ORDER BY count DESC
    LIMIT 15
  `);

  console.log('\nTop 15 Installers:');
  top.rows.forEach((r, i) => {
    const name = r.installed_by_name || 'Unknown';
    console.log(`${(i+1).toString().padStart(2)}. ${name.padEnd(35)} ${r.count}`);
  });
}

syncAll()
  .catch(err => console.error('Error:', err))
  .finally(() => pool.end());
