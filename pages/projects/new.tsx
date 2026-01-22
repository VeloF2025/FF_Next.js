import { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';
import { getAuth } from '../../lib/auth-mock';

// Lazy load ProjectCreationWizard to reduce initial bundle size
const ProjectCreationWizard = dynamic(
  () => import('@/modules/projects/components/ProjectWizard/ProjectCreationWizard').then(mod => ({ default: mod.ProjectCreationWizard })),
  {
    loading: () => (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    ),
    ssr: false
  }
);

export default function NewProjectPage() {
  return (
    <AppLayout>
      <ProjectCreationWizard />
    </AppLayout>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const { userId } = getAuth(ctx.req);

  if (!userId) {
    return {
      redirect: {
        destination: '/sign-in',
        permanent: false,
      },
    };
  }

  return { props: {} };
};