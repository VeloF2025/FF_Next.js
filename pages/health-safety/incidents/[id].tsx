/**
 * H&S Incident Detail Page
 * /health-safety/incidents/[id] - Read-only view of a single incident
 */

import type { NextPage, GetServerSideProps } from 'next';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { healthSafetyConfig } from '@/modules/navigation';
import { IncidentDetailView } from '@/modules/health-safety/components/IncidentDetailView';

const IncidentDetailPage: NextPage = () => {
  return (
    <AppLayout>
      <Head>
        <title>Incident Detail | H&S | FibreFlow</title>
      </Head>
      <ModulePage config={healthSafetyConfig}>
        <IncidentDetailView />
      </ModulePage>
    </AppLayout>
  );
};

export const getServerSideProps: GetServerSideProps = async () => {
  return { props: {} };
};

export default IncidentDetailPage;
