import { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';

const SOWListPage = dynamic(() => import('@/modules/sow/SOWListPage').then(mod => mod.SOWListPage), {
  ssr: false,
  loading: () => <div>Loading SOW list...</div>
});

export default function SOWListPageWrapper() {
  return (
    <AppLayout>
      <SOWListPage />
    </AppLayout>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  return { props: {} };
};