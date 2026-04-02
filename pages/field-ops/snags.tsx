/**
 * Snags Page
 * TQR audit report tracking for Civil QA.
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { constructionQaConfig } from '@/modules/navigation';
import { SnagsPage } from '@/modules/construction-qa/components/snags/SnagsPage';

const Snags: NextPage = () => {
  return (
    <AppLayout>
      <Head>
        <title>Snags | Civil QA | FibreFlow</title>
      </Head>
      <ModulePage config={constructionQaConfig}>
        <SnagsPage />
      </ModulePage>
    </AppLayout>
  );
};

export default Snags;
