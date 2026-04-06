/**
 * Snags List Page
 * All-projects snag table with filters, inline expansion, and pagination.
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { constructionQaConfig } from '@/modules/navigation';
import { SnagListPage } from '@/modules/construction-qa/components/snags/SnagListPage';

const SnagsList: NextPage = () => {
  return (
    <AppLayout>
      <Head>
        <title>Snags List | Civil QA | FibreFlow</title>
      </Head>
      <ModulePage config={constructionQaConfig}>
        <SnagListPage />
      </ModulePage>
    </AppLayout>
  );
};

export default SnagsList;
