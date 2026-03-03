/**
 * Field Ops Dashboard — Project drill-down landing page
 * Replaces flat feature list with hierarchical Project → Zone → PON view.
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { constructionQaConfig } from '@/modules/navigation';
import { FieldOpsDashboardPage } from '@/modules/construction-qa/components/dashboard/FieldOpsDashboardPage';

const FieldOpsIndex: NextPage = () => {
  return (
    <AppLayout>
      <Head>
        <title>Field Ops | FibreFlow</title>
      </Head>
      <ModulePage config={constructionQaConfig}>
        <FieldOpsDashboardPage />
      </ModulePage>
    </AppLayout>
  );
};

export default FieldOpsIndex;
