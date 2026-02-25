/**
 * OTDR Testing Page
 * Displays EXFO Exchange test results synced into FibreFlow.
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { constructionQaConfig } from '@/modules/navigation';
import { OtdrTestingPage } from '@/modules/construction-qa/components/OtdrTestingPage';

const OtdrPage: NextPage = () => {
  return (
    <AppLayout>
      <Head>
        <title>OTDR Testing | Civil QA | FibreFlow</title>
      </Head>
      <ModulePage config={constructionQaConfig}>
        <OtdrTestingPage />
      </ModulePage>
    </AppLayout>
  );
};

export default OtdrPage;
