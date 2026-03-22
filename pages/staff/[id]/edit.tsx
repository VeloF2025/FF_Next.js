import type { NextPage } from 'next';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';

const StaffEditForm = dynamic(
  () => import('../../../src/modules/staff/components/StaffEditForm').then(m => m.StaffEditForm),
  { loading: () => <div className="p-8 text-center text-gray-400">Loading form...</div>, ssr: false }
);

/**
 * Staff Edit Page - Tabbed edit form matching the view tabs
 */
const StaffEditPage: NextPage = () => {
  return (
    <AppLayout>
      <div className="p-6">
        <StaffEditForm />
      </div>
    </AppLayout>
  );
};

export default StaffEditPage;

// Prevent static generation to avoid router mounting issues
export const getServerSideProps = async () => {
  return {
    props: {},
  };
};