/**
 * CAPA Detail Page
 * /health-safety/capa/[id]
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { healthSafetyConfig } from '@/modules/navigation';
import { CAPADetailView } from '@/modules/health-safety/components/capa';

const CAPADetailPage: NextPage = () => (
  <AppLayout>
    <Head>
      <title>Corrective Action | H&S | FibreFlow</title>
    </Head>
    <ModulePage config={healthSafetyConfig}>
      <CAPADetailView />
    </ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default CAPADetailPage;
