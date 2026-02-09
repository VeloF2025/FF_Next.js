/**
 * Document Upload Page - Server Component
 */

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { DocumentUploadForm } from './DocumentUploadForm';

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
  } catch {
    return null;
  }
}

export default async function DocumentUploadPage({ params }: PageProps) {
  const { id } = await params;
  const asset = await getAsset(id);

  if (!asset) {
    return (
      <div className="p-6">
        <p className="text-red-500">Asset not found</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Link
        href={`/assets/${id}`}
        className="inline-flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] px-3 py-1.5 -ml-3 rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {asset.name}
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Upload Document
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        Add a document for <span className="font-medium">{asset.name}</span> ({asset.assetNumber})
      </p>

      <DocumentUploadForm assetId={id} />
    </div>
  );
}
