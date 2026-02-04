// TEMPORARY: Test DB connection and tables
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Test 1: Simple query
    const test1 = await sql`SELECT 1 as test`;

    // Test 2: Check if rfqs table exists and has data
    const test2 = await sql`SELECT COUNT(*) as count FROM rfqs`;

    // Test 3: Check if quotes table exists and has data
    const test3 = await sql`SELECT COUNT(*) as count FROM quotes`;

    // Test 4: Try a simple join
    const test4 = await sql`
      SELECT r.id, r.title, r.status
      FROM rfqs r
      LIMIT 3
    `;

    return res.json({
      success: true,
      results: {
        connectionTest: test1[0],
        rfqsCount: test2[0].count,
        quotesCount: test3[0].count,
        sampleRfqs: test4
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
}
