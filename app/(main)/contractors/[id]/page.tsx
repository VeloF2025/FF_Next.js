/**
 * Contractor Detail Page - Server Component
 */

// Force dynamic rendering - no caching for fresh data
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { neon } from '@neondatabase/serverless';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Edit, ArrowLeft } from 'lucide-react';
import type { Contractor } from '@/types/contractor.core.types';
import { ContractorDocuments } from '@/components/contractors/ContractorDocuments';
import { ContractorProjects } from '@/components/contractors/ContractorProjects';
import { ContractorPayments } from '@/components/contractors/ContractorPayments';
import { ProgressClaimsSection } from '@/components/contractors/ProgressClaimsSection';
import { InvoiceSection } from '@/components/contractors/InvoiceSection';
import { SiteVisitsSection } from '@/components/site-visits/SiteVisitsSection';

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

export default async function ContractorDetailPage({
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
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/contractors" className="inline-flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] px-3 py-1.5 -ml-3 rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors mb-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Contractors
          </Link>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">{contractor.companyName}</h1>
          <p className="text-[var(--ff-text-secondary)]">{contractor.registrationNumber}</p>
        </div>

        <Link
          href={`/contractors/${contractor.id}/edit`}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Edit className="h-4 w-4" />
          Edit
        </Link>
      </div>

      {/* Details */}
      <div className="space-y-6">
        {/* Company Information */}
        <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Company Information</h3>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <dt className="text-sm font-medium text-[var(--ff-text-secondary)]">Business Type</dt>
              <dd className="text-sm text-[var(--ff-text-primary)] mt-1">{contractor.businessType}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-[var(--ff-text-secondary)]">Industry Category</dt>
              <dd className="text-sm text-[var(--ff-text-primary)] mt-1">{contractor.industryCategory || '-'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-[var(--ff-text-secondary)]">Years in Business</dt>
              <dd className="text-sm text-[var(--ff-text-primary)] mt-1">{contractor.yearsInBusiness || '-'}</dd>
            </div>
          </dl>
        </div>

        {/* Contact Information */}
        <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Contact Information</h3>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <dt className="text-sm font-medium text-[var(--ff-text-secondary)]">Contact Person</dt>
              <dd className="text-sm text-[var(--ff-text-primary)] mt-1">{contractor.contactPerson}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-[var(--ff-text-secondary)]">Email</dt>
              <dd className="text-sm text-[var(--ff-text-primary)] mt-1">
                <a href={`mailto:${contractor.email}`} className="text-blue-400 hover:underline">
                  {contractor.email}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-[var(--ff-text-secondary)]">Phone</dt>
              <dd className="text-sm text-[var(--ff-text-primary)] mt-1">
                <a href={`tel:${contractor.phone}`} className="text-blue-400 hover:underline">
                  {contractor.phone}
                </a>
              </dd>
            </div>
            {contractor.alternatePhone && (
              <div>
                <dt className="text-sm font-medium text-[var(--ff-text-secondary)]">Alternate Phone</dt>
                <dd className="text-sm text-[var(--ff-text-primary)] mt-1">{contractor.alternatePhone}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Address */}
        {(contractor.physicalAddress || contractor.city || contractor.province) && (
          <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Address</h3>
            <dl className="space-y-2">
              {contractor.physicalAddress && (
                <div>
                  <dt className="text-sm font-medium text-[var(--ff-text-secondary)]">Physical Address</dt>
                  <dd className="text-sm text-[var(--ff-text-primary)] mt-1">{contractor.physicalAddress}</dd>
                </div>
              )}
              <div className="flex gap-4">
                {contractor.city && (
                  <div>
                    <dt className="text-sm font-medium text-[var(--ff-text-secondary)]">City</dt>
                    <dd className="text-sm text-[var(--ff-text-primary)] mt-1">{contractor.city}</dd>
                  </div>
                )}
                {contractor.province && (
                  <div>
                    <dt className="text-sm font-medium text-[var(--ff-text-secondary)]">Province</dt>
                    <dd className="text-sm text-[var(--ff-text-primary)] mt-1">{contractor.province}</dd>
                  </div>
                )}
                {contractor.postalCode && (
                  <div>
                    <dt className="text-sm font-medium text-[var(--ff-text-secondary)]">Postal Code</dt>
                    <dd className="text-sm text-[var(--ff-text-primary)] mt-1">{contractor.postalCode}</dd>
                  </div>
                )}
              </div>
            </dl>
          </div>
        )}

        {/* Banking Details */}
        {(contractor.bankName || contractor.accountNumber) && (
          <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Banking Details</h3>
            <dl className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {contractor.bankName && (
                <div>
                  <dt className="text-sm font-medium text-[var(--ff-text-secondary)]">Bank Name</dt>
                  <dd className="text-sm text-[var(--ff-text-primary)] mt-1">{contractor.bankName}</dd>
                </div>
              )}
              {contractor.accountNumber && (
                <div>
                  <dt className="text-sm font-medium text-[var(--ff-text-secondary)]">Account Number</dt>
                  <dd className="text-sm text-[var(--ff-text-primary)] mt-1">{contractor.accountNumber}</dd>
                </div>
              )}
              {contractor.branchCode && (
                <div>
                  <dt className="text-sm font-medium text-[var(--ff-text-secondary)]">Branch Code</dt>
                  <dd className="text-sm text-[var(--ff-text-primary)] mt-1">{contractor.branchCode}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {/* Status */}
        <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Status</h3>
          <dl className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <dt className="text-sm font-medium text-[var(--ff-text-secondary)]">Contractor Status</dt>
              <dd className="mt-1">
                <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-green-500/20 text-green-400">
                  {contractor.status.replace('_', ' ').toUpperCase()}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-[var(--ff-text-secondary)]">Compliance Status</dt>
              <dd className="mt-1">
                <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-blue-500/20 text-blue-400">
                  {contractor.complianceStatus.replace('_', ' ').toUpperCase()}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-[var(--ff-text-secondary)]">Active</dt>
              <dd className="text-sm text-[var(--ff-text-primary)] mt-1">{contractor.isActive ? 'Yes' : 'No'}</dd>
            </div>
          </dl>
        </div>

        {/* Notes */}
        {contractor.notes && (
          <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Notes</h3>
            <p className="text-sm text-[var(--ff-text-secondary)] whitespace-pre-wrap">{contractor.notes}</p>
          </div>
        )}
      </div>

      {/* Documents Section */}
      <div className="mt-8">
        <ContractorDocuments contractorId={contractor.id} />
      </div>

      {/* Onboarding Section - Link to dedicated page */}
      <div className="mt-8">
        <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-[var(--ff-text-primary)]">Onboarding Progress</h2>
              <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                Manage contractor onboarding workflow and required documents
              </p>
            </div>
            <Link
              href={`/contractors/${contractor.id}/onboarding`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              View Onboarding Workflow
            </Link>
          </div>
        </div>
      </div>

      {/* Project Assignments Section */}
      <div className="mt-8">
        <ContractorProjects contractorId={contractor.id} />
      </div>

      {/* Payment History Section */}
      <div className="mt-8">
        <ContractorPayments contractorId={contractor.id} />
      </div>

      {/* Progress Claims Section */}
      <div className="mt-8">
        <ProgressClaimsSection contractorId={contractor.id} />
      </div>

      {/* Invoices Section */}
      <div className="mt-8">
        <InvoiceSection contractorId={contractor.id} />
      </div>

      {/* Site Visits Section */}
      <div className="mt-8">
        <SiteVisitsSection
          contractorId={contractor.id}
          contractorName={contractor.companyName}
        />
      </div>
    </div>
  );
}
