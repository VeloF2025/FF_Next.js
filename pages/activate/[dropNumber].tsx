/**
 * DR Photo Unified Review - Dynamic Page
 *
 * Displays the unified review for a specific DR number
 * URL: /activate/[dropNumber]
 * Example: /activate/DR1733416
 */

import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import { UnifiedReviewCard } from '@/modules/activate/components/UnifiedReviewCard';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function DrPhotoUnifiedDetailPage() {
  const router = useRouter();
  const { dropNumber } = router.query;

  if (!dropNumber) {
    return (
      <AppLayout>
        <div className="flex h-64 items-center justify-center">
          <div className="text-gray-500">Loading...</div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6">
        {/* Header with back navigation */}
        <div className="mb-6 flex items-center gap-4">
          <Link
            href="/activate"
            className="inline-flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] px-3 py-1.5 rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to List
          </Link>
          <div className="h-6 w-px bg-gray-300" />
          <h1 className="text-2xl font-bold text-gray-900">
            Unified Review: {dropNumber}
          </h1>
        </div>

        {/* Unified Review Card */}
        <UnifiedReviewCard dropNumber={dropNumber as string} />
      </div>
    </AppLayout>
  );
}
