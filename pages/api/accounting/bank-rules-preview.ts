/**
 * Bank Rules Preview API
 * GET — returns count of transactions matching a pattern
 * Query params: bankAccountId, pattern, matchType (contains|starts_with|ends_with|exact)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { sql } from '@/lib/neon';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { bankAccountId, pattern, matchType = 'contains' } = req.query;

  if (!pattern || typeof pattern !== 'string') {
    return apiResponse.badRequest(res, 'pattern is required');
  }

  const cleanPattern = pattern.trim().toLowerCase();
  if (!cleanPattern) {
    return apiResponse.success(res, { matchCount: 0 });
  }

  // Build LIKE pattern based on match type
  let likePattern: string;
  if (matchType === 'starts_with') {
    likePattern = cleanPattern + '%';
  } else if (matchType === 'ends_with') {
    likePattern = '%' + cleanPattern;
  } else if (matchType === 'exact') {
    likePattern = cleanPattern;
  } else {
    likePattern = '%' + cleanPattern + '%';
  }

  type Row = Record<string, unknown>;

  // Explicit query branches — no conditional SQL fragments (Neon rule)
  let rows: Row[];
  const isExact = matchType === 'exact';

  if (bankAccountId && isExact) {
    rows = (await sql`
      SELECT COUNT(*) AS cnt FROM bank_transactions
      WHERE bank_account_id = ${bankAccountId} AND LOWER(description) = ${likePattern}
    `) as Row[];
  } else if (bankAccountId) {
    rows = (await sql`
      SELECT COUNT(*) AS cnt FROM bank_transactions
      WHERE bank_account_id = ${bankAccountId} AND LOWER(description) LIKE ${likePattern}
    `) as Row[];
  } else if (isExact) {
    rows = (await sql`
      SELECT COUNT(*) AS cnt FROM bank_transactions
      WHERE LOWER(description) = ${likePattern}
    `) as Row[];
  } else {
    rows = (await sql`
      SELECT COUNT(*) AS cnt FROM bank_transactions
      WHERE LOWER(description) LIKE ${likePattern}
    `) as Row[];
  }

  return apiResponse.success(res, { matchCount: Number(rows[0]?.cnt || 0) });
}

export default withAuth(withErrorHandler(handler));
