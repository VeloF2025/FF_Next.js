import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import { AppLayout } from '@/components/layout';
import BOQList from '../../../src/components/procurement/boq/BOQList';

interface BOQPageProps {
  projectId?: string;
  projectName?: string;
}

export default function BOQPage({ projectId, projectName }: BOQPageProps) {
  const router = useRouter();

  const handleCreateBOQ = () => {
    router.push('/procurement/boq/new');
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[var(--ff-text-primary)]">Bill of Quantities</h1>
          {projectName && (
            <p className="mt-2 text-[var(--ff-text-secondary)]">Project: {projectName}</p>
          )}
        </div>

        <BOQList
          onCreateBOQ={handleCreateBOQ}
          projectId={projectId}
          className="mt-6"
        />
      </div>
    </AppLayout>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { query } = context;
  const projectId = query.projectId as string | undefined;
  const projectName = query.projectName as string | undefined;

  return {
    props: {
      projectId: projectId || null,
      projectName: projectName || null
    }
  };
};