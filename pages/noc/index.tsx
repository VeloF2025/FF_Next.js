/**
 * NOC Dashboard Page
 * Network Operations Centre - ticket management overview
 * Uses ModulePage for tab navigation
 */

import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { nocConfig } from '@/modules/navigation';
import { TicketingDashboard } from '@/modules/noc/components/Dashboard/TicketingDashboard';

const NocIndexPage: NextPage = () => {
  return (
    <AppLayout>
      <ModulePage config={nocConfig}>
        <TicketingDashboard />
      </ModulePage>
    </AppLayout>
  );
};

export default NocIndexPage;
