import { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';

const SOWDashboard = dynamic(() => import('@/modules/sow/SOWDashboard').then(mod => mod.SOWDashboard || mod.default), {
  ssr: false,
  loading: () => <div>Loading SOW dashboard...</div>
});

export default function SOWDashboardPage() {
  return <SOWDashboard />;
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  return { props: {} };
};