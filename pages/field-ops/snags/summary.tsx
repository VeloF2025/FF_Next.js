/**
 * Snags Summary Page
 * Per-project snag count breakdown table.
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { constructionQaConfig } from '@/modules/navigation';
import { SnagSummaryPage } from '@/modules/construction-qa/components/snags/SnagSummaryPage';

const SnagsSummary: NextPage = () => {
  return (
    <AppLayout>
      <Head>
        <title>Snags Summary | Civil QA | FibreFlow</title>
      </Head>
      <ModulePage config={constructionQaConfig}>
        <SnagSummaryPage />
      </ModulePage>
    </AppLayout>
  );
};

export default SnagsSummary;
