/**
 * Bank Accounts API
 * GET /api/accounting/bank-accounts - List bank GL accounts with transaction summaries
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { sql } from '@/lib/neon';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const rows = await sql`
      SELECT
        ga.id,
        ga.account_code,
        ga.account_name,
        ga.description,
        ga.is_active,
        COALESCE(s.txn_count, 0) AS txn_count,
        COALESCE(s.total_debits, 0) AS total_debits,
        COALESCE(s.total_credits, 0) AS total_credits,
        COALESCE(s.total_credits, 0) - COALESCE(s.total_debits, 0) AS balance,
        s.first_date,
        s.last_date
      FROM gl_accounts ga
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::INT AS txn_count,
          SUM(CASE WHEN bt.amount < 0 THEN ABS(bt.amount) ELSE 0 END) AS total_debits,
          SUM(CASE WHEN bt.amount > 0 THEN bt.amount ELSE 0 END) AS total_credits,
          MIN(bt.transaction_date) AS first_date,
          MAX(bt.transaction_date) AS last_date
        FROM bank_transactions bt
        WHERE bt.bank_account_id = ga.id
      ) s ON TRUE
      WHERE ga.account_subtype = 'bank'
        AND ga.is_active = TRUE
      ORDER BY ga.account_code
    `;

    const accounts = rows.map(r => ({
      id: r.id,
      accountCode: r.account_code,
      accountName: r.account_name,
      description: r.description,
      isActive: r.is_active,
      txnCount: Number(r.txn_count),
      totalDebits: Number(r.total_debits),
      totalCredits: Number(r.total_credits),
      balance: Number(r.balance),
      firstDate: r.first_date instanceof Date
        ? r.first_date.toISOString().split('T')[0]
        : r.first_date ? String(r.first_date).split('T')[0] : null,
      lastDate: r.last_date instanceof Date
        ? r.last_date.toISOString().split('T')[0]
        : r.last_date ? String(r.last_date).split('T')[0] : null,
    }));

    return apiResponse.success(res, accounts);
  } catch (err) {
    log.error('Failed to get bank accounts', { error: err }, 'accounting-api');
    return apiResponse.badRequest(res, 'Failed to get bank accounts');
  }
}

export default withAuth(withErrorHandler(handler));
