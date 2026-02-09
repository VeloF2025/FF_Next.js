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
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          href={`/contractors/${id}`}
          className="inline-flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] mb-4 hover:text-blue-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Contractor Details
        </Link>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
              Contractor Onboarding
            </h1>
            <p className="text-[var(--ff-text-secondary)] mt-1">
              {contractor.companyName}
            </p>
          </div>

          <div className="text-right">
            <div className="text-sm text-[var(--ff-text-tertiary)]">Overall Progress</div>
            <div className="text-3xl font-bold text-blue-400">
              {contractor.onboardingProgress}%
            </div>
          </div>
        </div>
      </div>

      {/* Onboarding Stages */}
      <ContractorOnboardingStages contractorId={contractor.id} />
    </div>
  );
}
