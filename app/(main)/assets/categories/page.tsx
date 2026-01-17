/**
 * Asset Categories Page - Server Component
 * Manage asset categories
 */

import Link from 'next/link';
import { Plus, FolderOpen, Edit, Trash2 } from 'lucide-react';
import type { AssetCategory } from '@/modules/assets/types';
import { CategoriesClient } from './CategoriesClient';

async function getCategories(): Promise<AssetCategory[]> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005'}/api/assets/categories`,
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

export default async function CategoriesPage() {
  const categories = await getCategories();

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Asset Categories</h1>
          <p className="text-gray-600 dark:text-gray-400">Manage asset types and categories</p>
        </div>
        <Link
          href="/inventory/categories/new"
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="h-5 w-5 mr-2" />
          Add Category
        </Link>
      </div>

      <CategoriesClient initialCategories={categories} />
    </div>
  );
}
