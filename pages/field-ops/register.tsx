/**
 * Field Ops — operational Zone Delivery register (moved from /field-ops when
 * the QA Centre landing became the Project → Zone → PON delivery tree).
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { constructionQaConfig } from '@/modules/navigation';
import { ZoneDeliveryRegisterPage } from '@/modules/construction-qa/zone-delivery/components/ZoneDeliveryRegisterPage';

const FieldOpsRegister: NextPage = () => {
  return (
    <AppLayout>
      <Head>
        <title>Zone Delivery Register | FibreFlow</title>
      </Head>
      <ModulePage config={constructionQaConfig}>
        <ZoneDeliveryRegisterPage />
      </ModulePage>
    </AppLayout>
  );
};

export default FieldOpsRegister;
