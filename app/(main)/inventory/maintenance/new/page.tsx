/**
 * Schedule Maintenance Page - Server Component
 * Form to schedule new maintenance for an asset
 */

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { MaintenanceFormClient } from './MaintenanceFormClient';

interface PageProps {
  searchParams: Promise<{ assetId?: string; type?: string }>;
}

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005';

async function getAssets() {
  try {
    const response = await fetch(
      `${BASE_URL}/api/assets?limit=200`,
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

export default async function NewMaintenancePage({ searchParams }: PageProps) {
  const { assetId, type } = await searchParams;
  const assets = await getAssets();

  // Map type parameter to maintenance type
  const maintenanceType = type === 'calibration' ? 'calibration' : undefined;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link
          href="/inventory/maintenance"
          className="inline-flex items-center text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Maintenance
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {type === 'calibration' ? 'Schedule Calibration' : 'Schedule Maintenance'}
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          {type === 'calibration'
            ? 'Schedule calibration service for an asset'
            : 'Schedule maintenance for an asset'}
        </p>
      </div>

      <MaintenanceFormClient
        assets={assets}
        preselectedAssetId={assetId}
        preselectedType={maintenanceType}
      />
    </div>
  );
}
