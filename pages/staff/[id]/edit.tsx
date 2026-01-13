import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { StaffEditForm } from '../../../src/modules/staff/components/StaffEditForm';

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