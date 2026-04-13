/**
 * RFQ Number Generator
 * Generates unique RFQ and response numbers
 */

import { neon } from '@/lib/db-neon';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Generate unique RFQ number
 */
export async function generateRFQNumber(projectId: string): Promise<string> {
  const year = new Date().getFullYear();
  const count = await sql`
    SELECT COUNT(*) as count FROM rfqs
    WHERE project_id = ${projectId}
    AND EXTRACT(YEAR FROM created_at) = ${year}`;

  const sequence = (parseInt(count[0].count) + 1).toString().padStart(4, '0');
  return `RFQ-${year}-${projectId.slice(0, 4).toUpperCase()}-${sequence}`;
}

/**
 * Generate unique response number
 */
export async function generateResponseNumber(rfqId: string): Promise<string> {
  const count = await sql`
    SELECT COUNT(*) as count FROM rfq_responses
    WHERE rfq_id = ${rfqId}`;

  const sequence = (parseInt(count[0].count) + 1).toString().padStart(3, '0');
  return `RSP-${rfqId.slice(0, 8).toUpperCase()}-${sequence}`;
}
