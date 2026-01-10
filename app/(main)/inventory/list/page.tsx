/**
 * Assets List Page - Server Component
 * Shows all assets with filtering and pagination
 */

import { Suspense } from 'react';
import Link from 'next/link';
import { Plus, Loader2 } from 'lucide-react';
import { AssetListClient } from './AssetListClient';

function AssetListLoading() {
  return (
    <div className="bg-white rounded-lg shadow p-8 flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
    </div>
  );
}

export default async function AssetsListPage() {
  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Assets</h1>
          <p className="text-gray-600">Manage all company assets</p>
        </div>
        <Link
          href="/inventory/new"
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="h-5 w-5 mr-2" />
          Add Asset
        </Link>
      </div>

      <Suspense fallback={<AssetListLoading />}>
        <AssetListClient />
      </Suspense>
    </div>
  );
}
