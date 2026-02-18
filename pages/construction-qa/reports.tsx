/**
 * Construction QA Reports Page
 * Phase 1 placeholder — will be built out in Phase 2+
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { constructionQaConfig } from '@/modules/navigation';
import { BarChart3 } from 'lucide-react';

const ReportsPage: NextPage = () => {
  return (
    <AppLayout>
      <Head>
        <title>Reports | Construction QA | FibreFlow</title>
      </Head>
      <ModulePage config={constructionQaConfig}>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center mb-6">
            <BarChart3 className="w-8 h-8 text-blue-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Reports Coming Soon</h2>
          <p className="text-gray-400 max-w-md">
            Construction QA analytics and reporting will be available in a future update.
            This will include pass/fail trends, discipline breakdowns, and technician
            performance metrics.
          </p>
        </div>
      </ModulePage>
    </AppLayout>
  );
};

export default ReportsPage;
