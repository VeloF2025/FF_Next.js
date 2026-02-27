/**
 * Construction QA Centre Page
 * Main landing page for civil, optical, and splicing quality assurance
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { constructionQaConfig } from '@/modules/navigation';
import { ConstructionQaCentrePage } from '@/modules/construction-qa/components/ConstructionQaCentrePage';

const ConstructionQaIndex: NextPage = () => {
  return (
    <AppLayout>
      <Head>
        <title>Civil QA | FibreFlow</title>
      </Head>
      <ModulePage config={constructionQaConfig}>
        <ConstructionQaCentrePage />
      </ModulePage>
    </AppLayout>
  );
};

export default ConstructionQaIndex;
