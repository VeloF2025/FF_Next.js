/**
 * Field Ops QA Centre — operational Zone Delivery register landing page.
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { constructionQaConfig } from '@/modules/navigation';
import { ZoneDeliveryRegisterPage } from '@/modules/construction-qa/zone-delivery/components/ZoneDeliveryRegisterPage';

const FieldOpsIndex: NextPage = () => {
  return (
    <AppLayout>
      <Head>
        <title>Field Ops | FibreFlow</title>
      </Head>
      <ModulePage config={constructionQaConfig}>
        <ZoneDeliveryRegisterPage />
      </ModulePage>
    </AppLayout>
  );
};

export default FieldOpsIndex;
