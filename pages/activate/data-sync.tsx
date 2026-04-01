/**
 * Activate - Data Sync Page
 *
 * Data imports and synchronization management, accessible as a tab within Activate.
 */

import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { activateConfig } from '@/modules/navigation';
import { DataSyncPage } from '@/modules/data-sync';

const ActivateDataSyncPage: NextPage = () => {
  return (
    <AppLayout>
      <ModulePage config={activateConfig}>
        <DataSyncPage groupFilter={['activate', 'olt', 'billing', 'history']} />
      </ModulePage>
    </AppLayout>
  );
};

export default ActivateDataSyncPage;
