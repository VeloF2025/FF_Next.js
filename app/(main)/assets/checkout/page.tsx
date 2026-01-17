/**
 * Asset Checkout Page - Server Component
 * Form to check out an asset to staff, project, or vehicle
 */

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { CheckoutClient } from './CheckoutClient';

interface PageProps {
  searchParams: Promise<{ assetId?: string }>;
}

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005';

async function getAvailableAssets() {
  try {
    const response = await fetch(
      `${BASE_URL}/api/assets?status=available&limit=100`,
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

async function getStaffMembers() {
  try {
    const response = await fetch(
      `${BASE_URL}/api/staff?status=active`,
      { cache: 'no-store' }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error fetching staff:', error);
    return [];
  }
}

async function getProjects() {
  try {
    const response = await fetch(
      `${BASE_URL}/api/projects`,
      { cache: 'no-store' }
    );
    if (!response.ok) return [];
    const data = await response.json();
    // Filter to active projects only
    return (data.data || []).filter((p: any) => p.status === 'active' || p.status === 'in_progress');
  } catch (error) {
    console.error('Error fetching projects:', error);
    return [];
  }
}

export default async function CheckoutPage({ searchParams }: PageProps) {
  const { assetId } = await searchParams;
  const [assets, staffMembers, projects] = await Promise.all([
    getAvailableAssets(),
    getStaffMembers(),
    getProjects(),
  ]);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link
          href="/inventory/list"
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Assets
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Check Out Asset</h1>
        <p className="text-gray-600">Assign an asset to a staff member, project, or vehicle</p>
      </div>

      <CheckoutClient
        assets={assets}
        preselectedAssetId={assetId}
        staffMembers={staffMembers}
        projects={projects}
      />
    </div>
  );
}
