/**
 * Contractors List Page - Server Component
 * Fetches contractors server-side, passes to client components for interactivity
 */

import { neon } from '@neondatabase/serverless';
import type { Contractor } from '@/types/contractor.core.types';
import { ContractorsList } from '@/components/contractors/ContractorsList';

const sql = neon(process.env.DATABASE_URL || '');

async function getContractors(): Promise<Contractor[]> {
  try {
    const rows = await sql`
      SELECT * FROM contractors
      WHERE is_active = true
      ORDER BY created_at DESC
    `;

    return rows.map((row: any) => ({
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
    }));
  } catch (error: any) {
    // Handle missing table or database errors gracefully
    console.error('Error fetching contractors:', error);
    // Return empty array if table doesn't exist
    return [];
  }
}

export default async function ContractorsPage() {
  const contractors = await getContractors();

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Contractors</h1>
        <p className="text-gray-600">Manage contractor relationships</p>
      </div>

      <ContractorsList initialContractors={contractors} />
    </div>
  );
}
