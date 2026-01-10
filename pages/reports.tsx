import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';
import { RefreshCw } from 'lucide-react';

// Dynamic import of the Reports module with no SSR for performance
const ReportsModule = dynamic(
  () => import('../src/modules/reports/ReportsDashboard'),
  { 
    loading: () => <ReportsSkeleton />,
    ssr: false 
  }
);

function ReportsSkeleton() {
  return (
    <div className="ff-page-container">
      {/* Header Skeleton */}
      <div className="mb-6">
        <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-48 mb-2 animate-pulse"></div>
        <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-64 animate-pulse"></div>
      </div>

      {/* Action Bar Skeleton */}
      <div className="ff-card mb-6">
        <div className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-10 bg-[var(--ff-bg-tertiary)] rounded w-32 animate-pulse"></div>
            <div className="h-10 bg-[var(--ff-bg-tertiary)] rounded w-32 animate-pulse"></div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-10 bg-[var(--ff-bg-tertiary)] rounded w-28 animate-pulse"></div>
            <div className="h-10 bg-[var(--ff-bg-tertiary)] rounded w-28 animate-pulse"></div>
          </div>
        </div>
      </div>

      {/* Report Types Grid Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="ff-card p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse"></div>
              <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded w-16 animate-pulse"></div>
            </div>
            <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded w-3/4 mb-2 animate-pulse"></div>
            <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-full mb-4 animate-pulse"></div>
            <div className="flex items-center justify-between">
              <div className="h-3 bg-[var(--ff-bg-tertiary)] rounded w-24 animate-pulse"></div>
              <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-20 animate-pulse"></div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Reports Table Skeleton */}
      <div className="ff-card">
        <div className="p-6">
          <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded w-40 mb-4 animate-pulse"></div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--ff-border-light)]">
                  <th className="pb-3 text-left">
                    <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-32 animate-pulse"></div>
                  </th>
                  <th className="pb-3 text-left">
                    <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-20 animate-pulse"></div>
                  </th>
                  <th className="pb-3 text-left">
                    <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-24 animate-pulse"></div>
                  </th>
                  <th className="pb-3 text-left">
                    <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-28 animate-pulse"></div>
                  </th>
                  <th className="pb-3 text-left">
                    <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-16 animate-pulse"></div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b border-[var(--ff-border-light)]">
                    <td className="py-3">
                      <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-48 animate-pulse"></div>
                    </td>
                    <td className="py-3">
                      <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-24 animate-pulse"></div>
                    </td>
                    <td className="py-3">
                      <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded-full w-20 animate-pulse"></div>
                    </td>
                    <td className="py-3">
                      <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-32 animate-pulse"></div>
                    </td>
                    <td className="py-3">
                      <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-20 animate-pulse"></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <AppLayout>
      <Suspense fallback={<ReportsSkeleton />}>
        <ReportsModule />
      </Suspense>
    </AppLayout>
  );
}

// Prevent static generation to avoid router mounting issues
export const getServerSideProps = async () => {
  return {
    props: {},
  };
};