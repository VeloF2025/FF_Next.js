import Head from 'next/head';

import { ConnectionsNav } from '@/components/connections/ConnectionsNav';
import { CortexConnectionPanel } from '@/components/connections/CortexConnectionPanel';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProtectedPage } from '@/components/PermissionGate';

export default function CortexConnectionsPage() {
  return (
    <AppLayout>
      <Head>
        <title>AI Connections | FibreFlow</title>
      </Head>
      <ConnectionsNav />
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <ProtectedPage permission="cortex.review" action="view">
          <CortexConnectionPanel />
        </ProtectedPage>
      </div>
    </AppLayout>
  );
}
