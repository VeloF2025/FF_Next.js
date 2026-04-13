/**
 * Snags Resolution Reports Page
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { constructionQaConfig } from '@/modules/navigation';
import { SnagReportsPage } from '@/modules/construction-qa/components/snags/SnagReportsPage';

const SnagsReports: NextPage = () => {
  return (
    <AppLayout>
      <Head>
        <title>Snag Reports | Civil QA | FibreFlow</title>
      </Head>
      <ModulePage config={constructionQaConfig}>
        <SnagReportsPage />
      </ModulePage>
    </AppLayout>
  );
};

export default SnagsReports;
