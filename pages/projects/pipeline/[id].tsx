/**
 * Pipeline Project Detail Page
 * /projects/pipeline/[id] - View and manage individual pipeline project
 */

import type { NextPage } from 'next';
import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';

const PipelineProjectDetail = dynamic(
  () => import('@/modules/pipeline/components/PipelineProjectDetail'),
  {
    ssr: false,
    loading: () => <DetailLoadingSkeleton />,
  }
);

function DetailLoadingSkeleton() {
  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        {/* Back button skeleton */}
        <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded w-32 mb-6 animate-pulse"></div>

        {/* Header Skeleton */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-64 mb-2 animate-pulse"></div>
            <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-48 animate-pulse"></div>
          </div>
          <div className="flex gap-2">
            <div className="h-10 bg-[var(--ff-bg-tertiary)] rounded w-24 animate-pulse"></div>
            <div className="h-10 bg-[var(--ff-bg-tertiary)] rounded w-24 animate-pulse"></div>
          </div>
        </div>

        {/* Progress bar skeleton */}
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border-light)] mb-8">
          <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-48 mb-4 animate-pulse"></div>
          <div className="h-3 bg-[var(--ff-bg-tertiary)] rounded-full w-full animate-pulse"></div>
        </div>

        {/* Two column layout skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main content - Approval gates */}
          <div className="lg:col-span-2 space-y-4">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border-light)]"
              >
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 bg-[var(--ff-bg-tertiary)] rounded-full animate-pulse"></div>
                  <div className="flex-1">
                    <div className="h-5 bg-[var(--ff-bg-tertiary)] rounded w-48 mb-2 animate-pulse"></div>
                    <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-32 animate-pulse"></div>
                  </div>
                  <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-24 animate-pulse"></div>
                </div>
              </div>
            ))}
          </div>

          {/* Sidebar - Project info */}
          <div className="space-y-6">
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border-light)]">
              <div className="h-5 bg-[var(--ff-bg-tertiary)] rounded w-32 mb-4 animate-pulse"></div>
              {[...Array(6)].map((_, i) => (
                <div key={i} className="mb-4">
                  <div className="h-3 bg-[var(--ff-bg-tertiary)] rounded w-24 mb-1 animate-pulse"></div>
                  <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-40 animate-pulse"></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const PipelineProjectDetailPage: NextPage = () => {
  return (
    <AppLayout>
      <Suspense fallback={<DetailLoadingSkeleton />}>
        <PipelineProjectDetail />
      </Suspense>
    </AppLayout>
  );
};

export const getServerSideProps = async () => {
  return { props: {} };
};

export default PipelineProjectDetailPage;
