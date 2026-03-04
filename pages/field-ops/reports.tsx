/**
 * Construction QA Reports Page — Poles Planted Dashboard
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { constructionQaConfig } from '@/modules/navigation';
import { FieldOpsReportsPage } from '@/modules/construction-qa/components/reports/FieldOpsReportsPage';

const ReportsPage: NextPage = () => {
  return (
    <AppLayout>
      <Head>
        <title>Reports | Civil QA | FibreFlow</title>
      </Head>
      <ModulePage config={constructionQaConfig}>
        <FieldOpsReportsPage />
      </ModulePage>
    </AppLayout>
  );
};

export default ReportsPage;
