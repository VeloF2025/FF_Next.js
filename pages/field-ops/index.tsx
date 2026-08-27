/**
 * Field Ops QA Centre — Project → Zone → PON delivery tree.
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { constructionQaConfig } from '@/modules/navigation';
import { DeliveryTreePage } from '@/modules/construction-qa/delivery-tree/components/DeliveryTreePage';

const FieldOpsIndex: NextPage = () => {
  return (
    <AppLayout>
      <Head>
        <title>QA Centre | FibreFlow</title>
      </Head>
      <ModulePage config={constructionQaConfig}>
        <DeliveryTreePage />
      </ModulePage>
    </AppLayout>
  );
};

export default FieldOpsIndex;
