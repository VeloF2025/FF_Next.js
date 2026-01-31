import { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';

const PoleTrackerDashboard = dynamic(() => import('@/modules/projects/pole-tracker/PoleTrackerDashboard').then(mod => mod.PoleTrackerDashboard || mod.default), {
  ssr: false,
  loading: () => <div>Loading pole tracker...</div>
});

export default function PoleTrackerPage() {
  return <PoleTrackerDashboard />;
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  return { props: {} };
};