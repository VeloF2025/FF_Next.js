/**
 * Asset Check-in Page - Server Component
 * Form to return a checked-out asset
 */

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { CheckinClient } from './CheckinClient';

interface PageProps {
  searchParams: Promise<{ assetId?: string }>;
}

async function getAssignedAssets() {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005'}/api/assets?status=assigned&limit=100`,
      { cache: 'no-store' }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error fetching assets:', error);
    return [];
  }
}

export default async function CheckinPage({ searchParams }: PageProps) {
  const { assetId } = await searchParams;
  const assets = await getAssignedAssets();

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link
          href="/assets/list"
          className="inline-flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] px-3 py-1.5 -ml-3 rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Assets
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Check In Asset</h1>
        <p className="text-gray-600 dark:text-gray-400">Return a checked-out asset to inventory</p>
      </div>

      <CheckinClient assets={assets} preselectedAssetId={assetId} />
    </div>
  );
}
