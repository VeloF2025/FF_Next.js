import Head from 'next/head';

import { ConnectionsNav } from '@/components/connections/ConnectionsNav';
import { FibreFlowConnectionPanel } from '@/components/connections/FibreFlowConnectionPanel';
import { AppLayout } from '@/components/layout/AppLayout';

export default function FibreFlowConnectionsPage() {
  return (
    <AppLayout>
      <Head>
        <title>AI Connections | FibreFlow</title>
      </Head>
      <ConnectionsNav />
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <FibreFlowConnectionPanel />
      </div>
    </AppLayout>
  );
}
