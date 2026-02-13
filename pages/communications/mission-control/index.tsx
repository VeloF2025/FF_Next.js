import { AppLayout } from '@/components/layout/AppLayout';
import MissionControlDashboard from '@/modules/mission-control/MissionControlDashboard';

export default function MissionControlPage() {
  return (
    <AppLayout>
      <MissionControlDashboard />
    </AppLayout>
  );
}

export const getServerSideProps = async () => {
  return {
    props: {},
  };
};
