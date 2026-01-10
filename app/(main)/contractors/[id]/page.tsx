/**
 * Contractor Detail Page - Server Component
 */

import { neon } from '@neondatabase/serverless';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Edit, ArrowLeft } from 'lucide-react';
import type { Contractor } from '@/types/contractor.core.types';
import { ContractorDocuments } from '@/components/contractors/ContractorDocuments';
import { ContractorProjects } from '@/components/contractors/ContractorProjects';

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
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
            <Link href="/contractors" className="hover:text-blue-600">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <span>Back to Contractors</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{contractor.companyName}</h1>
          <p className="text-gray-600">{contractor.registrationNumber}</p>
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
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Company Information</h3>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <dt className="text-sm font-medium text-gray-500">Business Type</dt>
              <dd className="text-sm text-gray-900 mt-1">{contractor.businessType}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Industry Category</dt>
              <dd className="text-sm text-gray-900 mt-1">{contractor.industryCategory || '-'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Years in Business</dt>
              <dd className="text-sm text-gray-900 mt-1">{contractor.yearsInBusiness || '-'}</dd>
            </div>
          </dl>
        </div>

        {/* Contact Information */}
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Contact Information</h3>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <dt className="text-sm font-medium text-gray-500">Contact Person</dt>
              <dd className="text-sm text-gray-900 mt-1">{contractor.contactPerson}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Email</dt>
              <dd className="text-sm text-gray-900 mt-1">
                <a href={`mailto:${contractor.email}`} className="text-blue-600 hover:underline">
                  {contractor.email}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Phone</dt>
              <dd className="text-sm text-gray-900 mt-1">
                <a href={`tel:${contractor.phone}`} className="text-blue-600 hover:underline">
                  {contractor.phone}
                </a>
              </dd>
            </div>
            {contractor.alternatePhone && (
              <div>
                <dt className="text-sm font-medium text-gray-500">Alternate Phone</dt>
                <dd className="text-sm text-gray-900 mt-1">{contractor.alternatePhone}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Address */}
        {(contractor.physicalAddress || contractor.city || contractor.province) && (
          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Address</h3>
            <dl className="space-y-2">
              {contractor.physicalAddress && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Physical Address</dt>
                  <dd className="text-sm text-gray-900 mt-1">{contractor.physicalAddress}</dd>
                </div>
              )}
              <div className="flex gap-4">
                {contractor.city && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500">City</dt>
                    <dd className="text-sm text-gray-900 mt-1">{contractor.city}</dd>
                  </div>
                )}
                {contractor.province && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Province</dt>
                    <dd className="text-sm text-gray-900 mt-1">{contractor.province}</dd>
                  </div>
                )}
                {contractor.postalCode && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Postal Code</dt>
                    <dd className="text-sm text-gray-900 mt-1">{contractor.postalCode}</dd>
                  </div>
                )}
              </div>
            </dl>
          </div>
        )}

        {/* Banking Details */}
        {(contractor.bankName || contractor.accountNumber) && (
          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Banking Details</h3>
            <dl className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {contractor.bankName && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Bank Name</dt>
                  <dd className="text-sm text-gray-900 mt-1">{contractor.bankName}</dd>
                </div>
              )}
              {contractor.accountNumber && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Account Number</dt>
                  <dd className="text-sm text-gray-900 mt-1">{contractor.accountNumber}</dd>
                </div>
              )}
              {contractor.branchCode && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Branch Code</dt>
                  <dd className="text-sm text-gray-900 mt-1">{contractor.branchCode}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {/* Status */}
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Status</h3>
          <dl className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <dt className="text-sm font-medium text-gray-500">Contractor Status</dt>
              <dd className="mt-1">
                <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
                  {contractor.status.replace('_', ' ').toUpperCase()}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Compliance Status</dt>
              <dd className="mt-1">
                <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                  {contractor.complianceStatus.replace('_', ' ').toUpperCase()}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Active</dt>
              <dd className="text-sm text-gray-900 mt-1">{contractor.isActive ? 'Yes' : 'No'}</dd>
            </div>
          </dl>
        </div>

        {/* Notes */}
        {contractor.notes && (
          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Notes</h3>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{contractor.notes}</p>
          </div>
        )}
      </div>

      {/* Documents Section */}
      <div className="mt-8">
        <ContractorDocuments contractorId={contractor.id} />
      </div>

      {/* Onboarding Section - Link to dedicated page */}
      <div className="mt-8">
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Onboarding Progress</h2>
              <p className="text-sm text-gray-600 mt-1">
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
    </div>
  );
}
