/**
 * Activate Reports Page
 * Analytics and reporting dashboards for DR activations
 * Uses ModulePage for tab navigation: Dashboard, QA Centre, Reports
 */

import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { activateConfig } from '@/modules/navigation';
import { DrListPage } from '@/modules/activate/components/DrListPage';

const ActivateReportsPage: NextPage = () => {
  return (
    <AppLayout>
      <ModulePage config={activateConfig}>
        <DrListPage showTab="reports" />
      </ModulePage>
    </AppLayout>
  );
};

export default ActivateReportsPage;
