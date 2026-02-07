/**
 * Backup Mohadin drops for Nov 10, 2025 before making changes
 * Run: node scripts/backup-mohadin-nov10.js
 */

const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL || 'process.env.DATABASE_URL&channel_binding=require');

async function backupMohadinDrops() {
  console.log('📦 Backing up Mohadin drops for 2025-11-10...');

  try {
    // Get all Mohadin drops for today
    const drops = await sql`
      SELECT *
      FROM qa_photo_reviews
      WHERE project = 'Mohadin'
        AND created_at >= '2025-11-10 00:00:00'
        AND created_at < '2025-11-11 00:00:00'
      ORDER BY created_at ASC
    `;

    console.log(`\n✅ Backed up ${drops.length} drops:`);
    drops.forEach(drop => {
      console.log(`  - ${drop.drop_number} (${drop.created_at})`);
    });

    // Write to file
    const fs = require('fs');
    const backupData = {
      timestamp: new Date().toISOString(),
      count: drops.length,
      drops: drops
    };

    fs.writeFileSync(
      '/tmp/mohadin-backup-nov10-2025.json',
      JSON.stringify(backupData, null, 2)
    );

    console.log('\n💾 Backup saved to: /tmp/mohadin-backup-nov10-2025.json');
    console.log('✅ Backup complete!');

  } catch (error) {
    console.error('❌ Backup failed:', error);
    process.exit(1);
  }
}

backupMohadinDrops();
