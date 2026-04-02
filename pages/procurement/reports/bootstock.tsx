/**
 * Bootstock Reports Page
 * ONT and UPS serial stock tracking — FT deliveries through installation
 */

import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { procurementConfig } from '@/modules/navigation';
import { BootstockReportsPage } from '@/modules/procurement/reports/BootstockReportsPage';

const BootstockPage: NextPage = () => {
  return (
    <AppLayout>
      <ModulePage config={procurementConfig}>
        <BootstockReportsPage />
      </ModulePage>
    </AppLayout>
  );
};

export default BootstockPage;
