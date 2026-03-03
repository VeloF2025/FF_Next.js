/**
 * Project Detail Page — Zone/PON drill-down for a single project
 */

import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { constructionQaConfig } from '@/modules/navigation';
import { ProjectDetailPage } from '@/modules/construction-qa/components/project/ProjectDetailPage';

const ProjectDetailRoute: NextPage = () => {
  const router = useRouter();
  const projectId = router.query.projectId as string;

  if (!projectId) return null;

  return (
    <AppLayout>
      <Head>
        <title>Project Detail | Civil QA | FibreFlow</title>
      </Head>
      <ModulePage config={constructionQaConfig}>
        <ProjectDetailPage projectId={projectId} />
      </ModulePage>
    </AppLayout>
  );
};

export default ProjectDetailRoute;
