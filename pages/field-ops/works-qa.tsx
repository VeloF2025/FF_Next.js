import type { NextPage } from 'next';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { constructionQaConfig } from '@/modules/navigation';
import { WorksQAPage } from '@/modules/works-qa/components/WorksQAPage';

const WorksQARoute: NextPage = () => (
  <AppLayout>
    <Head>
      <title>Works QA | FibreFlow</title>
    </Head>
    <ModulePage config={constructionQaConfig}>
      <WorksQAPage />
    </ModulePage>
  </AppLayout>
);

export default WorksQARoute;
