import { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';

const UnifiedTrackerGrid = dynamic(() => import('@/modules/projects/tracker/UnifiedTrackerGrid').then(mod => mod.UnifiedTrackerGrid), {
  ssr: false,
  loading: () => <div>Loading tracker...</div>
});

export default function ProjectTrackerPage() {
  const router = useRouter();
  const { id } = router.query;
  
  if (!id) return <AppLayout><div>Loading...</div></AppLayout>;

  return (
    <AppLayout>
      <UnifiedTrackerGrid projectId={id as string} />
    </AppLayout>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  return { props: {} };
};