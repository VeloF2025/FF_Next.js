/**
 * Staff Import Page
 * Import staff members from CSV/Excel files
 */

import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { staffConfig } from '@/modules/navigation';
import { StaffImportAdvanced } from '@/modules/staff/components/StaffImportAdvanced';

export default function StaffImportPage() {
  return (
    <AppLayout>
      <ModulePage config={staffConfig}>
        <StaffImportAdvanced />
      </ModulePage>
    </AppLayout>
  );
}

export const getServerSideProps = async () => {
  return { props: {} };
};
