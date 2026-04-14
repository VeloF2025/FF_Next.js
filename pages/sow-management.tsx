import { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';

const SOWManagement = dynamic(() => import('@/modules/projects/sow/SOWManagement').then(mod => mod.SOWManagement), {
  ssr: false,
  loading: () => <div>Loading SOW management...</div>
});

export default function SOWManagementPage() {
  return (
    <AppLayout>
      <SOWManagement />
    </AppLayout>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  return { props: {} };
};