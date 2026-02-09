/**
 * New Asset Page - Server Component
 * Form to create a new asset
 */

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AssetFormClient } from './AssetFormClient';

async function getCategories() {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005'}/api/assets/categories?isActive=true`,
      { cache: 'no-store' }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error fetching categories:', error);
    return [];
  }
}

export default async function NewAssetPage() {
  const categories = await getCategories();

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <Link
          href="/assets/list"
          className="inline-flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] px-3 py-1.5 -ml-3 rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Assets
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Register New Asset</h1>
        <p className="text-gray-600 dark:text-gray-400">Add a new asset to the inventory</p>
      </div>

      <AssetFormClient categories={categories} />
    </div>
  );
}
