/**
 * QField System Monitor Page
 * Infrastructure health monitoring and management for QFieldCloud
 */

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';
import { Server, Loader2 } from 'lucide-react';

const QFieldDashboard = dynamic(
  () => import('@/modules/system/qfield/QFieldDashboard').then(mod => ({ default: mod.QFieldDashboard })),
  {
    loading: () => <QFieldSkeleton />,
    ssr: false
  }
);

function QFieldSkeleton() {
  return (
    <div className="p-6 space-y-6">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between">
        <div>
          <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-48 animate-pulse"></div>
          <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-64 mt-2 animate-pulse"></div>
        </div>
        <div className="h-10 w-10 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse"></div>
      </div>

      {/* Status Bar Skeleton */}
      <div className="h-16 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] animate-pulse"></div>

      {/* Stats Grid Skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse"></div>
              <div className="space-y-2">
                <div className="h-3 bg-[var(--ff-bg-tertiary)] rounded w-16 animate-pulse"></div>
                <div className="h-5 bg-[var(--ff-bg-tertiary)] rounded w-12 animate-pulse"></div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Services Grid Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
            <div className="p-4 border-b border-[var(--ff-border-light)]">
              <div className="h-5 bg-[var(--ff-bg-tertiary)] rounded w-32 animate-pulse"></div>
            </div>
            <div className="p-4 space-y-3">
              {[...Array(3)].map((_, j) => (
                <div key={j} className="h-12 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse"></div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Loading indicator */}
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--ff-text-tertiary)]" />
        <span className="ml-2 text-[var(--ff-text-tertiary)]">Loading QField status...</span>
      </div>
    </div>
  );
}

export default function QFieldPage() {
  return (
    <AppLayout>
      <Suspense fallback={<QFieldSkeleton />}>
        <QFieldDashboard />
      </Suspense>
    </AppLayout>
  );
}

export const getServerSideProps = async () => {
  return {
    props: {},
  };
};
