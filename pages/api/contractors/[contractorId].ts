/**
 * Contractors API - Single Contractor (Pages Router)
 * Workaround for Vercel App Router dynamic route issues
 *
 * Protected by Arcjet:
 * - Bot detection
 * - Rate limiting (30 req/min)
 * - Attack protection
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withArcjetProtection, ajStrict } from '@/lib/arcjet';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL || '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Destructure with rename - keeps internal code using 'id'
  const { contractorId: id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Invalid contractor ID');
  }

  // GET - Get single contractor
  if (req.method === 'GET') {
    try {
      const [contractor] = await sql`
        SELECT * FROM contractors WHERE id = ${id}
      `;

      if (!contractor) {
        return apiResponse.notFound(res, 'Contractor not found');
      }

      return res.status(200).json({ data: mapDbToContractor(contractor) });
    } catch (error) {
      log.error('Error fetching contractor', { error });
      return apiResponse.internalError(res, new Error('Failed to fetch contractor'));
    }
  }

  // PUT - Update contractor
  if (req.method === 'PUT') {
    try {
      const body = req.body;

      const [existing] = await sql`SELECT id FROM contractors WHERE id = ${id}`;
      if (!existing) {
        return apiResponse.notFound(res, 'Contractor not found');
      }

      const [updated] = await sql`
        UPDATE contractors
        SET
          company_name = COALESCE(${body.companyName}, company_name),
          registration_number = COALESCE(${body.registrationNumber}, registration_number),
          business_type = COALESCE(${body.businessType}, business_type),
          industry_category = COALESCE(${body.industryCategory}, industry_category),
          years_in_business = COALESCE(${body.yearsInBusiness}, years_in_business),
          contact_person = COALESCE(${body.contactPerson}, contact_person),
          email = COALESCE(${body.email}, email),
          phone = COALESCE(${body.phone}, phone),
          alternate_phone = COALESCE(${body.alternatePhone}, alternate_phone),
          physical_address = COALESCE(${body.physicalAddress}, physical_address),
          city = COALESCE(${body.city}, city),
          province = COALESCE(${body.province}, province),
          postal_code = COALESCE(${body.postalCode}, postal_code),
          bank_name = COALESCE(${body.bankName}, bank_name),
          account_number = COALESCE(${body.accountNumber}, account_number),
          branch_code = COALESCE(${body.branchCode}, branch_code),
          status = COALESCE(${body.status}, status),
          is_active = COALESCE(${body.isActive !== undefined ? body.isActive : null}, is_active),
          compliance_status = COALESCE(${body.complianceStatus}, compliance_status),
          specializations = COALESCE(${body.specializations}, specializations),
          certifications = COALESCE(${body.certifications}, certifications),
          notes = COALESCE(${body.notes}, notes),
          tags = COALESCE(${body.tags}, tags),
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;

      return res.status(200).json({ data: mapDbToContractor(updated) });
    } catch (error: any) {
      log.error('Error updating contractor', { error });
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Contractor with this registration number or email already exists' });
      }
      return apiResponse.internalError(res, new Error('Failed to update contractor'));
    }
  }

  // DELETE - Delete contractor
  if (req.method === 'DELETE') {
    try {
      const [existing] = await sql`SELECT id FROM contractors WHERE id = ${id}`;
      if (!existing) {
        return apiResponse.notFound(res, 'Contractor not found');
      }

      await sql`DELETE FROM contractors WHERE id = ${id}`;
      return res.status(200).json({ success: true, message: 'Contractor deleted successfully' });
    } catch (error) {
      log.error('Error deleting contractor', { error });
      return apiResponse.internalError(res, new Error('Failed to delete contractor'));
    }
  }

  // Method not allowed
  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'PUT', 'DELETE']);
}

// Export with Arcjet protection and auth
export default withAuth(withArcjetProtection(handler, ajStrict));

// Helper function to map database row to Contractor interface
function mapDbToContractor(row: any) {
  return {
    id: row.id,
    companyName: row.company_name,
    registrationNumber: row.registration_number,
    businessType: row.business_type,
    industryCategory: row.industry_category || '',
    yearsInBusiness: row.years_in_business,
    contactPerson: row.contact_person,
    email: row.email,
    phone: row.phone,
    alternatePhone: row.alternate_phone,
    physicalAddress: row.physical_address,
    city: row.city,
    province: row.province,
    postalCode: row.postal_code,
    bankName: row.bank_name,
    accountNumber: row.account_number,
    branchCode: row.branch_code,
    status: row.status,
    isActive: row.is_active,
    complianceStatus: row.compliance_status,
    specializations: row.specializations || [],
    certifications: row.certifications || [],
    notes: row.notes,
    tags: row.tags || [],
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
