import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';

const WorkflowPortalPage = dynamic(
  () => import('@/modules/workflow/WorkflowPortalPage'),
  { loading: () => <div className="p-8 text-center text-gray-400">Loading portal...</div>, ssr: false }
);

export default function WorkflowPortal() {
  return (
    <AppLayout>
      <WorkflowPortalPage />
    </AppLayout>
  );
}

// Prevent static generation to avoid router mounting issues
export const getServerSideProps = async () => {
  return {
    props: {},
  };
};
