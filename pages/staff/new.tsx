import type { NextPage } from 'next';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';

const StaffForm = dynamic(
  () => import('../../src/modules/staff/components/StaffForm').then(m => m.StaffForm),
  { loading: () => <div className="p-8 text-center text-gray-400">Loading form...</div>, ssr: false }
);

const StaffCreatePage: NextPage = () => {
  return (
    <AppLayout>
      <div className="p-6">
        <StaffForm />
      </div>
    </AppLayout>
  );
};

export default StaffCreatePage;

// Prevent static generation to avoid router mounting issues
export const getServerSideProps = async () => {
  return {
    props: {},
  };
};