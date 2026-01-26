/**
 * Data Sync Page
 * Unified data sync management page combining maintenance, activate, and OLT report syncs
 *
 * URL Structure:
 * - /system/data-sync - Overview dashboard
 * - /system/data-sync?group=maintenance - Maintenance tabs
 * - /system/data-sync?group=activate - Activate tabs
 * - /system/data-sync?group=olt - OLT Report tabs
 */

import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { DataSyncPage } from '@/modules/data-sync';
import { useAuth } from '@/contexts/AuthContext';
import { Permission } from '@/types/auth.types';
import { AlertTriangle } from 'lucide-react';

export default function DataSyncRoute() {
  const { user, hasPermission } = useAuth();

  // Check permissions
  const hasAccess = hasPermission(Permission.SYSTEM_ADMIN) || user?.role === 'super_admin';

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
      <DataSyncPage />
    </AppLayout>
  );
}
