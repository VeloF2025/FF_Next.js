/**
 * Contractors Update API - Flat Route (Vercel Workaround)
 * Works around Vercel's 405 issues with /api/contractors/[id]
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id, ...updates } = req.body;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Invalid or missing ID' });
    }

    // Check if contractor exists
    const [existing] = await sql`SELECT id FROM contractors WHERE id = ${id}`;
    if (!existing) {
      return res.status(404).json({ error: 'Contractor not found' });
    }

    // Update contractor
    const [updated] = await sql`
      UPDATE contractors
      SET
        company_name = COALESCE(${updates.companyName}, company_name),
        registration_number = COALESCE(${updates.registrationNumber}, registration_number),
        business_type = COALESCE(${updates.businessType}, business_type),
        industry_category = COALESCE(${updates.industryCategory}, industry_category),
        years_in_business = COALESCE(${updates.yearsInBusiness}, years_in_business),
        contact_person = COALESCE(${updates.contactPerson}, contact_person),
        email = COALESCE(${updates.email}, email),
        phone = COALESCE(${updates.phone}, phone),
        alternate_phone = COALESCE(${updates.alternatePhone}, alternate_phone),
        physical_address = COALESCE(${updates.physicalAddress}, physical_address),
        city = COALESCE(${updates.city}, city),
        province = COALESCE(${updates.province}, province),
        postal_code = COALESCE(${updates.postalCode}, postal_code),
        bank_name = COALESCE(${updates.bankName}, bank_name),
        account_number = COALESCE(${updates.accountNumber}, account_number),
        branch_code = COALESCE(${updates.branchCode}, branch_code),
        status = COALESCE(${updates.status}, status),
        is_active = COALESCE(${updates.isActive !== undefined ? updates.isActive : null}, is_active),
        compliance_status = COALESCE(${updates.complianceStatus}, compliance_status),
        specializations = COALESCE(${updates.specializations}, specializations),
        certifications = COALESCE(${updates.certifications}, certifications),
        notes = COALESCE(${updates.notes}, notes),
        tags = COALESCE(${updates.tags}, tags),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    return res.status(200).json({ data: mapDbToContractor(updated) });
  } catch (error: any) {
    console.error('Error updating contractor:', error);
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'Contractor with this registration number or email already exists'
      });
    }
    return res.status(500).json({ error: 'Failed to update contractor' });
  }
}

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

export default withAuth(handler);
