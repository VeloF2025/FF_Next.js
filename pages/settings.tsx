import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';
import { Settings2 } from 'lucide-react';

// Dynamic import of the Settings module with no SSR
const SettingsModule = dynamic(
  () => import('../src/pages/Settings').then(mod => ({ default: mod.Settings })),
  {
    loading: () => <SettingsSkeleton />,
    ssr: false
  }
);

function SettingsSkeleton() {
  return (
    <div className="p-6">
      {/* Tab Navigation Skeleton */}
      <div className="mb-6">
        <div className="border-b border-[var(--ff-border-light)]">
          <div className="flex space-x-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center space-x-2 py-3">
                <div className="w-4 h-4 bg-[var(--ff-bg-tertiary)] rounded animate-pulse"></div>
                <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-20 animate-pulse"></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Content Skeleton */}
      <div className="space-y-6 max-w-4xl">
        {/* Card 1 */}
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
          <div className="flex items-center mb-4">
            <Settings2 className="w-5 h-5 text-[var(--ff-text-tertiary)] mr-2" />
            <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded w-40 animate-pulse"></div>
          </div>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 bg-[var(--ff-bg-tertiary)] rounded animate-pulse"></div>
            ))}
          </div>
        </div>

        {/* Card 2 */}
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
          <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded w-48 mb-4 animate-pulse"></div>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-32 animate-pulse"></div>
                <div className="w-12 h-6 bg-[var(--ff-bg-tertiary)] rounded-full animate-pulse"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <AppLayout>
      <Suspense fallback={<SettingsSkeleton />}>
        <SettingsModule />
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
