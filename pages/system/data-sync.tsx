/**
 * System Data Sync Page
 * NOC and QField sync operations (system-level data management)
 */

import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { DataSyncPage } from '@/modules/data-sync';
import { usePermission } from '@/hooks/usePermission';
import { AlertTriangle, Loader2 } from 'lucide-react';

export default function DataSyncRoute() {
  const { can, isLoading } = usePermission();

  const hasAccess = can('system.data-sync', 'view');

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--ff-accent)]" />
        </div>
      </AppLayout>
    );
  }

  if (!hasAccess) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <AlertTriangle className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
            <h1 className="text-2xl font-semibold text-white mb-2">Access Denied</h1>
            <p className="text-gray-400">
              You don&apos;t have permission to access Data Sync.
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <Head>
        <title>Data Sync | FibreFlow</title>
      </Head>
      <DataSyncPage groupFilter={['noc', 'qfield']} />
    </AppLayout>
  );
}
