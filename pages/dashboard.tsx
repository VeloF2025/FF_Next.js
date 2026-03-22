import { useState, useEffect } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';

const Dashboard = dynamic(
  () => import('@/modules/dashboard/Dashboard').then(m => m.Dashboard),
  { loading: () => <DashboardSkeleton />, ssr: false }
);
import { RefreshCw } from 'lucide-react';

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-48 mb-2 animate-pulse"></div>
        <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-64 animate-pulse"></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border-light)]">
            <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-20 mb-2 animate-pulse"></div>
            <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-16 mb-1 animate-pulse"></div>
            <div className="h-3 bg-[var(--ff-bg-tertiary)] rounded w-24 animate-pulse"></div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border-light)]">
            <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded w-32 mb-4 animate-pulse"></div>
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex items-center">
                  <div className="w-10 h-10 bg-[var(--ff-bg-tertiary)] rounded-lg mr-3 animate-pulse"></div>
                  <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-24 animate-pulse"></div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="lg:col-span-2">
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border-light)]">
            <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded w-32 mb-4 animate-pulse"></div>
            <div className="space-y-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex items-start">
                  <div className="w-8 h-8 bg-[var(--ff-bg-tertiary)] rounded mr-3 animate-pulse"></div>
                  <div className="flex-1">
                    <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-3/4 mb-1 animate-pulse"></div>
                    <div className="h-3 bg-[var(--ff-bg-tertiary)] rounded w-24 animate-pulse"></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border-light)]">
        <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded w-48 mb-4 animate-pulse"></div>
        <div className="h-64 flex items-center justify-center bg-[var(--ff-bg-tertiary)] rounded-lg">
          <RefreshCw className="w-8 h-8 text-[var(--ff-text-tertiary)] animate-spin" />
        </div>
      </div>
    </div>
  );
}

// Client-side wrapper to prevent hydration issues
function ClientDashboard() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <DashboardSkeleton />;
  }

  return <Dashboard />;
}

export default function DashboardPage() {
  return (
    <AppLayout>
      <Head>
        <title>Dashboard | FibreFlow</title>
      </Head>
      <ClientDashboard />
    </AppLayout>
  );
}

export const getServerSideProps = async () => {
  return { props: {} };
};
