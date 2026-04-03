/**
 * Design System Audit Page
 * Live inventory of all UI components and design patterns
 */

import React from 'react';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import DesignAuditDashboard from '@/modules/system/components/DesignAuditDashboard';

export default function DesignAuditPage() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <AppLayout>
      <Head>
        <title>Design System Audit | FibreFlow</title>
      </Head>
      <div className="p-6 max-w-[1600px] mx-auto">
        <DesignAuditDashboard />
      </div>
    </AppLayout>
  );
}
