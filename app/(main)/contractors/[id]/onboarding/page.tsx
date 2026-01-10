/**
 * Contractor Onboarding Page - Dedicated workflow page
 * URL: /contractors/[id]/onboarding
 */

import { neon } from '@neondatabase/serverless';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ContractorOnboardingStages } from '@/components/contractors/onboarding';

const sql = neon(process.env.DATABASE_URL || '');

async function getContractor(id: string) {
  const [row] = await sql`
    SELECT id, company_name, onboarding_progress
    FROM contractors
    WHERE id = ${id}
  `;

  if (!row) return null;

  return {
    id: row.id,
    companyName: row.company_name,
    onboardingProgress: row.onboarding_progress || 0,
  };
}

export default async function ContractorOnboardingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const contractor = await getContractor(id);

  if (!contractor) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href={`/contractors/${id}`}
            className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-blue-600 mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Contractor Details
          </Link>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Contractor Onboarding
              </h1>
              <p className="text-lg text-gray-600 mt-1">
                {contractor.companyName}
              </p>
            </div>

            <div className="text-right">
              <div className="text-sm text-gray-500">Overall Progress</div>
              <div className="text-3xl font-bold text-blue-600">
                {contractor.onboardingProgress}%
              </div>
            </div>
          </div>
        </div>

        {/* Onboarding Stages */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <ContractorOnboardingStages contractorId={contractor.id} />
        </div>
      </div>
    </div>
  );
}
