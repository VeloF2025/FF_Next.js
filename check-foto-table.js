const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL || 'process.env.DATABASE_URL');

async function checkTable() {
  try {
    const result = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'foto_ai_reviews'
    `;
    console.log(result.length > 0 ? 'Table exists ✓' : 'Table does not exist ✗');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkTable();
