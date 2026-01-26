/**
 * Activate Dashboard Page
 * Overview stats and project breakdown for installations/activations
 * Uses ModulePage for tab navigation: Dashboard, QA Centre, Reports
 */

import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { activateConfig } from '@/modules/navigation';
import { DrListPage } from '@/modules/activate/components/DrListPage';

const ActivateIndexPage: NextPage = () => {
  return (
    <AppLayout>
      <ModulePage config={activateConfig}>
        <DrListPage showTab="dashboard" />
      </ModulePage>
    </AppLayout>
  );
};

export default ActivateIndexPage;
