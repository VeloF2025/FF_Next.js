/**
 * Pipeline Service Authorities Admin Page
 * /pipeline/authorities - Manage service authority contacts
 */

import type { NextPage } from 'next';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/contexts/AuthContext';

const AuthorityManager = dynamic(
  () => import('@/modules/pipeline/components/AuthorityManager'),
  {
    ssr: false,
    loading: () => <AuthoritiesLoadingSkeleton />,
  }
);

function AuthoritiesLoadingSkeleton() {
  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Skeleton */}
        <div className="flex items-center justify-between">
          <div>
            <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-48 mb-2 animate-pulse" />
            <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-64 animate-pulse" />
          </div>
          <div className="h-10 bg-[var(--ff-bg-tertiary)] rounded w-32 animate-pulse" />
        </div>

        {/* Search Skeleton */}
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
          <div className="h-10 bg-[var(--ff-bg-tertiary)] rounded w-full animate-pulse" />
        </div>

        {/* Table Skeleton */}
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
          <div className="p-4 bg-[var(--ff-bg-tertiary)]">
            <div className="h-6 bg-[var(--ff-bg-secondary)] rounded w-full animate-pulse" />
          </div>
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="p-4 border-t border-[var(--ff-border-light)]"
            >
              <div className="h-5 bg-[var(--ff-bg-tertiary)] rounded w-3/4 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const AuthoritiesPage: NextPage = () => {
  const { currentUser } = useAuth();

  return (
    <AppLayout>
      <div className="p-6">
        <div className="max-w-7xl mx-auto">
          <AuthorityManager currentUserId={currentUser?.id} />
        </div>
      </div>
    </AppLayout>
  );
};

export default AuthoritiesPage;
