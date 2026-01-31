import { GetServerSideProps } from 'next';
import { getAuth } from '../../../lib/auth-mock';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';

const ProjectDetail = dynamic(() => import('@/pages/ProjectDetail').then(mod => mod.ProjectDetail || mod.default), {
  ssr: false,
  loading: () => <div>Loading project...</div>
});

export default function ProjectDetailPage() {
  const router = useRouter();
  const { id } = router.query;

  if (!id) return <AppLayout><div>Loading...</div></AppLayout>;

  return (
    <AppLayout>
      <ProjectDetail projectId={id as string} />
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