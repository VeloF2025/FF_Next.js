/**
 * DR Photo Unified - Monitoring Page (Pages Router)
 *
 * Renders the System Health Dashboard with full view (not compact)
 * for monitoring VLM categorization and retry queue status.
 */

import { AppLayout } from '@/components/layout';
import { SystemHealthDashboard } from '@/modules/dr-photo-unified/components/SystemHealthDashboard';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function DrPhotoUnifiedMonitoringPage() {
  return (
    <AppLayout>
      <div className="p-6 max-w-6xl mx-auto">
        {/* Header with back navigation */}
        <div className="mb-6 flex items-center gap-4">
          <Link
            href="/dr-photo-unified"
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <ArrowLeft className="h-5 w-5" />
            <span>Back to List</span>
          </Link>
          <div className="h-6 w-px bg-gray-300 dark:bg-gray-600" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            System Health Monitoring
          </h1>
        </div>

        {/* Full System Health Dashboard */}
        <SystemHealthDashboard
          autoRefresh={true}
          refreshInterval={30}
          compact={false}
        />
      </div>
    </AppLayout>
  );
}
