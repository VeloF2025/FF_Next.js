/**
 * Suppliers CSV Export
 * GET — export suppliers as CSV with same filters as list endpoint
 *
 * Query params: status, category, isPreferred, search
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { buildCSV, sendCSV, type CSVColumn } from '@/lib/csv';

const sql = neon(process.env.DATABASE_URL!);

const columns: CSVColumn[] = [
  { key: 'companyName', label: 'Company Name' },
  { key: 'tradingName', label: 'Trading Name' },
  { key: 'status', label: 'Status' },
  { key: 'contactName', label: 'Contact Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'registrationNo', label: 'Registration No' },
  { key: 'taxNo', label: 'Tax No' },
  { key: 'beeLevel', label: 'BEE Level' },
  { key: 'preferred', label: 'Preferred' },
  { key: 'paymentTerms', label: 'Payment Terms' },
  { key: 'rating', label: 'Rating' },
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  try {
    const { status, category, isPreferred, search } = req.query;

    const conditions: string[] = ['1=1'];
    const params: (string | boolean)[] = [];
    let idx = 1;

    if (status) {
      conditions.push(`status = $${idx}`);
      params.push(status as string);
      idx++;
    }
    if (category) {
      conditions.push(`$${idx} = ANY(product_categories)`);
      params.push(category as string);
      idx++;
    }
    if (isPreferred === 'true') {
      conditions.push('is_preferred = true');
    }
    if (search) {
      conditions.push(`(name ILIKE $${idx} OR company_name ILIKE $${idx} OR email ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const query = `
      SELECT company_name, name, status, contact_name, email, phone,
        registration_number, tax_number, bee_level, is_preferred,
        payment_terms, rating
      FROM suppliers
      WHERE ${conditions.join(' AND ')}
      ORDER BY COALESCE(company_name, name) ASC
      LIMIT 10000
    `;

    const rows = await sql.query(query, params);

    const mapped = rows.map((r: Record<string, unknown>) => ({
      companyName: r.company_name || r.name || '',
      tradingName: r.name || '',
      status: r.status || '',
      contactName: r.contact_name || '',
      email: r.email || '',
      phone: r.phone || '',
      registrationNo: r.registration_number || '',
      taxNo: r.tax_number || '',
      beeLevel: r.bee_level ?? '',
      preferred: r.is_preferred ? 'Yes' : 'No',
      paymentTerms: r.payment_terms || '',
      rating: r.rating ?? '',
    }));

    const csv = buildCSV(columns, mapped);
    const filename = `suppliers-${new Date().toISOString().split('T')[0]}.csv`;
    return sendCSV(res, csv, filename);
  } catch (err) {
    log.error('Failed to export suppliers', { error: err }, 'suppliers-export');
    return apiResponse.internalError(res, err, 'Failed to export suppliers');
  }
}

export default withAuth(withErrorHandler(handler));
