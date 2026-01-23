/**
 * New Asset Category Page - Server Component
 * Form to create a new asset category
 */

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { CategoryFormClient } from './CategoryFormClient';

export default function NewCategoryPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link
          href="/assets/categories"
          className="inline-flex items-center text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Categories
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Add New Category</h1>
        <p className="text-gray-600 dark:text-gray-400">Create a new asset category template</p>
      </div>

      <CategoryFormClient />
    </div>
  );
}
