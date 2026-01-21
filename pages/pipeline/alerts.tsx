/**
 * Pipeline Alerts Page
 * Shows expiring approvals and due follow-ups
 */

import type { NextPage } from 'next';
import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { AppLayout } from '@/components/layout';

const AlertsDashboard = dynamic(
  () => import('@/modules/pipeline/components/AlertsDashboard'),
  { ssr: false }
);

function LoadingSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-48" />
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 bg-gray-200 rounded-lg" />
        ))}
      </div>
      <div className="h-64 bg-gray-200 rounded-lg" />
      <div className="h-64 bg-gray-200 rounded-lg" />
    </div>
  );
}

const PipelineAlertsPage: NextPage = () => {
  return (
    <AppLayout>
      <div className="p-6">
        <Suspense fallback={<LoadingSkeleton />}>
          <AlertsDashboard />
        </Suspense>
      </div>
    </AppLayout>
  );
};

export default PipelineAlertsPage;
