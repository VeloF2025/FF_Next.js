import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';
import { RefreshCw } from 'lucide-react';

// Dynamic import of the Analytics module with no SSR for performance
const AnalyticsModule = dynamic(
  () => import('../src/modules/analytics/AnalyticsDashboard'),
  {
    loading: () => <AnalyticsSkeleton />,
    ssr: false
  }
);

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between">
        <div>
          <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-56 mb-2 animate-pulse"></div>
          <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-48 animate-pulse"></div>
        </div>
        <div className="h-10 bg-[var(--ff-bg-tertiary)] rounded w-24 animate-pulse"></div>
      </div>

      {/* Stats Cards Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-4 w-4 bg-[var(--ff-bg-tertiary)] rounded animate-pulse"></div>
              <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-20 animate-pulse"></div>
            </div>
            <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-24 mb-1 animate-pulse"></div>
            <div className="h-3 bg-[var(--ff-bg-tertiary)] rounded w-16 animate-pulse"></div>
          </div>
        ))}
      </div>

      {/* Filters Bar Skeleton */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
        <div className="flex items-center gap-4">
          <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-32 animate-pulse"></div>
          <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-32 animate-pulse"></div>
        </div>
      </div>

      {/* Charts Row Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
          <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded w-32 mb-4 animate-pulse"></div>
          <div className="h-64 flex items-center justify-center bg-[var(--ff-bg-tertiary)] rounded">
            <RefreshCw className="w-8 h-8 text-[var(--ff-text-tertiary)] animate-spin" />
          </div>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
          <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded w-32 mb-4 animate-pulse"></div>
          <div className="h-64 flex items-center justify-center bg-[var(--ff-bg-tertiary)] rounded">
            <RefreshCw className="w-8 h-8 text-[var(--ff-text-tertiary)] animate-spin" />
          </div>
        </div>
      </div>

      {/* Table Skeleton */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
        <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded w-48 mb-4 animate-pulse"></div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-1/3 animate-pulse"></div>
              <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-1/4 animate-pulse"></div>
              <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-1/5 animate-pulse"></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <AppLayout>
      <div className="p-6">
        <Suspense fallback={<AnalyticsSkeleton />}>
          <AnalyticsModule />
        </Suspense>
      </div>
    </AppLayout>
  );
}

// Prevent static generation to avoid router mounting issues
export const getServerSideProps = async () => {
  return {
    props: {},
  };
};
