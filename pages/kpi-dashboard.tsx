import { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';
import { AppLayout } from '../src/components/layout/AppLayout';

const EnhancedKPIDashboard = dynamic(
  () => import('../src/modules/kpi-dashboard/EnhancedKPIDashboard').then(m => m.EnhancedKPIDashboard),
  { loading: () => <div className="p-8 text-center text-gray-400">Loading dashboard...</div>, ssr: false }
);

export default function KPIDashboardPage() {
  return (
    <AppLayout>
      <EnhancedKPIDashboard />
    </AppLayout>
  );
}

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    props: {},
  };
};