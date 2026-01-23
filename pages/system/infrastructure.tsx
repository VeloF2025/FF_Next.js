/**
 * Infrastructure Health Dashboard Page
 * Admin-only comprehensive system monitoring
 */

import React from 'react';
import Head from 'next/head';
import { AppLayout } from '@/components/layout';
import { InfrastructureHealthDashboard } from '@/modules/system/components';
import { Permission } from '@/types/auth.types';
import { useAuth } from '@/contexts/AuthContext';
import { ShieldAlert, Lock } from 'lucide-react';

export default function InfrastructurePage() {
  const { user, hasPermission } = useAuth();

  // Check for admin permission
  const isAdmin = hasPermission(Permission.SYSTEM_ADMIN);

  return (
    <AppLayout>
      <Head>
        <title>Infrastructure Health | FibreFlow</title>
        <meta name="description" content="System-wide infrastructure health monitoring" />
      </Head>

      <div className="container mx-auto px-4 py-6 max-w-7xl">
        {!isAdmin ? (
          // Access denied for non-admin users
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mb-6">
              <Lock className="w-10 h-10 text-red-400" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Access Restricted</h1>
            <p className="text-white/60 max-w-md">
              The Infrastructure Health Dashboard is only available to system administrators.
              If you believe you should have access, please contact your administrator.
            </p>
            <div className="mt-6 flex items-center gap-2 text-sm text-white/40">
              <ShieldAlert className="w-4 h-4" />
              Required permission: SYSTEM_ADMIN
            </div>
          </div>
        ) : (
          <InfrastructureHealthDashboard />
        )}
      </div>
    </AppLayout>
  );
}
