import { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';

const SOWDashboard = dynamic(() => import('@/modules/sow/SOWDashboard').then(mod => mod.SOWDashboard), {
  ssr: false,
  loading: () => <div>Loading SOW dashboard...</div>
});

export default function SOWDashboardPage() {
  return (
    <AppLayout>
      <SOWDashboard />
    </AppLayout>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  return { props: {} };
};