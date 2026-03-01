import { AppLayout } from '@/components/layout/AppLayout';
import CommunicationsHub from '@/modules/communications/CommunicationsHub';

export default function CommunicationsPage() {
  return (
    <AppLayout>
      <CommunicationsHub />
    </AppLayout>
  );
}

// Prevent static generation to avoid router mounting issues
export const getServerSideProps = async () => {
  return {
    props: {},
  };
};