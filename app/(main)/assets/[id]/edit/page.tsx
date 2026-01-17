/**
 * Edit Asset Page - Server Component
 * Form to edit an existing asset
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { EditAssetClient } from './EditAssetClient';

interface PageProps {
  params: Promise<{ id: string }>;
}

async function getAsset(id: string) {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005'}/api/assets/${id}`,
      { cache: 'no-store' }
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error fetching asset:', error);
    return null;
  }
}

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

export default async function EditAssetPage({ params }: PageProps) {
  const { id } = await params;
  const [asset, categories] = await Promise.all([
    getAsset(id),
    getCategories(),
  ]);

  if (!asset) {
    notFound();
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <Link
          href={`/inventory/${id}`}
          className="inline-flex items-center text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Asset
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Edit Asset</h1>
        <p className="text-gray-600 dark:text-gray-400">{asset.name} - {asset.assetNumber}</p>
      </div>

      <EditAssetClient asset={asset} categories={categories} />
    </div>
  );
}
