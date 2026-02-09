/**
 * Edit Contractor Page - Server Component
 */

// Force dynamic rendering - no caching for fresh data
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { neon } from '@neondatabase/serverless';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ContractorForm } from '@/components/contractors/ContractorForm';
import type { Contractor } from '@/types/contractor.core.types';

const sql = neon(process.env.DATABASE_URL || '');

async function getContractor(id: string): Promise<Contractor | null> {
  const [row] = await sql`
    SELECT * FROM contractors WHERE id = ${id}
  `;

  if (!row) return null;

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

export default async function EditContractorPage({
  params,
}: {
  params: { id: string };
}) {
  const contractor = await getContractor(params.id);

  if (!contractor) {
    notFound();
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] mb-2">
          <Link href={`/contractors/${contractor.id}`} className="hover:text-blue-400">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span>Back to Contractor</span>
        </div>
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Edit Contractor</h1>
        <p className="text-[var(--ff-text-secondary)]">{contractor.companyName}</p>
      </div>

      <ContractorForm contractor={contractor} />
    </div>
  );
}
