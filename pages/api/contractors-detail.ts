/**
 * Contractors Detail API
 * GET /api/contractors-detail?id=<uuid>
 * Returns a single contractor by ID
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL || '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'id query parameter is required');
  }

  const [row] = await sql`
    SELECT
      id,
      company_name AS "companyName",
      registration_number AS "registrationNumber",
      business_type AS "businessType",
      contact_person AS "contactPerson",
      email,
      phone,
      physical_address AS "physicalAddress",
      city,
      province,
      postal_code AS "postalCode",
      status,
      is_active AS "isActive",
      compliance_status AS "complianceStatus"
    FROM contractors
    WHERE id = ${id}
  `;

  if (!row) {
    return apiResponse.notFound(res, 'Contractor', id);
  }

  return apiResponse.success(res, row);
}

export default withAuth(withErrorHandler(handler));
