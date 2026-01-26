/**
 * Pipeline Dashboard Page
 * /projects/pipeline - Main view for project pipeline management
 */

import type { NextPage } from 'next';
import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';

const PipelineDashboard = dynamic(
  () => import('@/modules/pipeline/components/PipelineDashboard'),
  {
    ssr: false,
    loading: () => <PipelineLoadingSkeleton />,
  }
);

function PipelineLoadingSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between">
        <div>
          <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-48 mb-2 animate-pulse"></div>
          <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-64 animate-pulse"></div>
        </div>
        <div className="h-10 bg-[var(--ff-bg-tertiary)] rounded w-32 animate-pulse"></div>
      </div>

      {/* Stats Cards Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border-light)]"
          >
            <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-20 mb-2 animate-pulse"></div>
            <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-16 animate-pulse"></div>
          </div>
        ))}
      </div>

      {/* Table Skeleton */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)]">
        <div className="p-4 border-b border-[var(--ff-border-light)]">
          <div className="h-10 bg-[var(--ff-bg-tertiary)] rounded w-64 animate-pulse"></div>
        </div>
        <div className="divide-y divide-[var(--ff-border-light)]">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="p-4">
              <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded w-full animate-pulse"></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const PipelinePage: NextPage = () => {
  return (
    <AppLayout>
      <ModulePage config={projectsConfig}>
        <Suspense fallback={<PipelineLoadingSkeleton />}>
          <PipelineDashboard />
        </Suspense>
      </ModulePage>
    </AppLayout>
  );
};

export const getServerSideProps = async () => {
  return { props: {} };
};

export default PipelinePage;
