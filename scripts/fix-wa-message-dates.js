const { neon } = require('@neondatabase/serverless');
const sql = neon('process.env.DATABASE_URL');

const corrections = [
  { drop: 'DR1732094', date: '2025-11-05 18:01:03+00:00' },
  { drop: 'DR1732104', date: '2025-11-05 16:04:58+00:00' },
  { drop: 'DR1732134', date: '2025-10-31 07:14:59+00:00' },
  { drop: 'DR1732135', date: '2025-11-05 17:53:45+00:00' },
  { drop: 'DR1732151', date: '2025-11-05 17:06:56+00:00' },
  { drop: 'DR1732152', date: '2025-11-05 17:31:07+00:00' },
  { drop: 'DR1732267', date: '2025-11-05 15:10:28+00:00' },
  { drop: 'DR1732269', date: '2025-11-05 15:10:28+00:00' },
  { drop: 'DR1733238', date: '2025-11-05 17:06:26+00:00' },
  { drop: 'DR1748538', date: '2025-11-05 16:24:56+00:00' },
  { drop: 'DR1751812', date: '2025-10-25 08:56:17+00:00' },
  { drop: 'DR1751828', date: '2025-10-25 10:28:09+00:00' },
  { drop: 'DR1751830', date: '2025-10-25 08:40:48+00:00' },
  { drop: 'DR1751832', date: '2025-10-25 06:24:42+00:00' },
  { drop: 'DR1751833', date: '2025-10-25 09:18:02+00:00' },
  { drop: 'DR1751834', date: '2025-10-25 11:36:31+00:00' },
  { drop: 'DR1751836', date: '2025-10-25 10:53:39+00:00' },
  { drop: 'DR1751859', date: '2025-10-25 09:34:56+00:00' },
  { drop: 'DR1751880', date: '2025-11-05 15:38:11+00:00' },
  { drop: 'DR1751881', date: '2025-11-05 15:38:11+00:00' },
  { drop: 'DR1751888', date: '2025-11-05 17:04:42+00:00' },
  { drop: 'DR1751915', date: '2025-11-05 16:47:59+00:00' },
  { drop: 'DR1751940', date: '2025-11-05 17:46:20+00:00' },
  { drop: 'DR1751943', date: '2025-11-05 16:01:52+00:00' },
  { drop: 'DR1751945', date: '2025-11-05 16:25:54+00:00' },
  { drop: 'DR1751948', date: '2025-11-05 16:29:16+00:00' },
  { drop: 'DR1752186', date: '2025-11-05 15:48:33+00:00' },
];

(async () => {
  console.log('🔧 Fixing whatsapp_message_date with actual WhatsApp timestamps...\n');

  let updated = 0;
  for (const {drop, date} of corrections) {
    const result = await sql`
      UPDATE qa_photo_reviews
      SET whatsapp_message_date = ${date}
      WHERE drop_number = ${drop}
      AND DATE(created_at) = CURRENT_DATE
    `;

    if (result.count > 0) {
      const dateOnly = date.split(' ')[0];
      console.log(`✅ ${drop}: ${dateOnly}`);
      updated += result.count;
    }
  }

  console.log(`\n✅ Updated ${updated} drops with correct WhatsApp message dates`);

  // Verify the fix
  console.log('\n📊 Testing query now...');
  const rows = await sql`
    SELECT
      DATE(COALESCE(whatsapp_message_date, created_at)) as date,
      COALESCE(project, 'Unknown') as project,
      COUNT(*) as count
    FROM qa_photo_reviews
    WHERE DATE(COALESCE(whatsapp_message_date, created_at)) = CURRENT_DATE
    GROUP BY DATE(COALESCE(whatsapp_message_date, created_at)), project
    ORDER BY project ASC
  `;

  console.log('\nToday\'s submissions (after fix):');
  console.table(rows);

  const total = rows.reduce((sum, r) => sum + parseInt(r.count), 0);
  console.log(`Total: ${total} drops`);
})();
