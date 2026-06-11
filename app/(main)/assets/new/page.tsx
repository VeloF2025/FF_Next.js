/**
 * New Asset Page - Server Component
 * Form to create a new asset
 */

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AssetFormClient } from './AssetFormClient';
import { authCookieHeader } from '@/lib/auth/ssr-fetch';
import { log } from '@/lib/logger';

async function getCategories() {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005'}/api/assets/categories?isActive=true`,
      { cache: 'no-store', headers: await authCookieHeader() }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    log.error('Error fetching categories:', { error }, 'NewAssetPage');
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
