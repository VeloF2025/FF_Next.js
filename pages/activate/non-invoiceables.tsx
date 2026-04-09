/**
 * Activate - Non-Invoiceable Action Centre
 *
 * Unified view and action centre for all non-invoiceable issues:
 * pre-provisions, serial mismatches, offline, signal issues, missing DRs.
 */

import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { activateConfig } from '@/modules/navigation';
import { NonInvoiceablesPage } from '@/modules/non-invoiceables/components/NonInvoiceablesPage';

const ActivateNonInvoiceablesPage: NextPage = () => {
  return (
    <AppLayout>
      <ModulePage config={activateConfig}>
        <NonInvoiceablesPage />
      </ModulePage>
    </AppLayout>
  );
};

export default ActivateNonInvoiceablesPage;
