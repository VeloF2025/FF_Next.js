/**
 * Delivery tracker — the flat PON/zone view Johan Scott asked for in #2394.
 *
 * Sibling of /field-ops (the gate-derived register): this one reports what is
 * true of the network, that one reports what FibreFlow has been told.
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { constructionQaConfig } from '@/modules/navigation';
import { ZoneTrackerPage } from '@/modules/construction-qa/zone-delivery/components/ZoneTrackerPage';

const FieldOpsTracker: NextPage = () => (
  <AppLayout>
    <Head>
      <title>Delivery Tracker | FibreFlow</title>
    </Head>
    <ModulePage config={constructionQaConfig}>
      <ZoneTrackerPage />
    </ModulePage>
  </AppLayout>
);

export default FieldOpsTracker;
