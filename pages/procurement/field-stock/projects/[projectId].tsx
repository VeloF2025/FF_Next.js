import type { GetServerSideProps, NextPage } from 'next';
import { AppLayout } from '@/components/layout';
import { SerialDrilldownView } from '@/components/field-stock/SerialDrilldownView';
import { getProjectName } from '@/modules/procurement/field-stock/services/serialHoldingsService';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PageProps {
  projectId: string;
  projectName: string;
}

const ProjectDrilldownPage: NextPage<PageProps> = ({ projectId, projectName }) => (
  <AppLayout>
    <SerialDrilldownView
      kicker="Project"
      heading={projectName}
      fixedFilter={{ projectId }}
      backHref="/procurement/field-stock/projects"
      backLabel="All projects"
    />
  </AppLayout>
);

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const raw = ctx.params?.projectId;
  const projectId = Array.isArray(raw) ? raw[0] : raw;
  if (!projectId || !UUID_RE.test(projectId)) {
    return { notFound: true };
  }
  const projectName = await getProjectName(projectId);
  if (!projectName) {
    return { notFound: true };
  }
  return { props: { projectId, projectName } };
};

export default ProjectDrilldownPage;
