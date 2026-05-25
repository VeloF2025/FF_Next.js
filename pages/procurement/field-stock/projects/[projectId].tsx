import type { GetServerSideProps, NextPage } from 'next';
import { AppLayout } from '@/components/layout';
import { SerialDrilldownView } from '@/components/field-stock/SerialDrilldownView';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PageProps {
  projectId: string;
}

const ProjectDrilldownPage: NextPage<PageProps> = ({ projectId }) => (
  <AppLayout>
    <SerialDrilldownView
      kicker="Project"
      nameField="allocatedProjectName"
      fallbackHeading={projectId}
      fixedFilter={{ projectId }}
      backHref="/procurement/field-stock/projects"
      backLabel="All projects"
    />
  </AppLayout>
);

// UUID-format validation only — no DB read here, so no entity data is exposed
// before the client-side auth gate + gated search API resolve. The project
// name is derived from the authenticated search response.
export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const raw = ctx.params?.projectId;
  const projectId = Array.isArray(raw) ? raw[0] : raw;
  if (!projectId || !UUID_RE.test(projectId)) {
    return { notFound: true };
  }
  return { props: { projectId } };
};

export default ProjectDrilldownPage;
