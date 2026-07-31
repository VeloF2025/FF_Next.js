import Head from 'next/head';

import { ConnectionsNav } from '@/components/connections/ConnectionsNav';
import { CortexConnectionPanel } from '@/components/connections/CortexConnectionPanel';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProtectedPage } from '@/components/PermissionGate';

interface CortexConnectionsPageProps {
  revokeEnabled: boolean;
}

/**
 * Read the flag per request rather than at build time: one build is deployed to
 * both environments, so baking it in would freeze whichever value the build box
 * happened to have.
 */
export function getServerSideProps(): { props: CortexConnectionsPageProps } {
  return {
    props: {
      revokeEnabled:
        (process.env.CORTEX_MCP_TOKEN_UI_ENABLED ?? '').trim().toLowerCase() === 'true',
    },
  };
}

export default function CortexConnectionsPage({
  revokeEnabled,
}: CortexConnectionsPageProps) {
  return (
    <ProtectedRoute fallbackPath="/sign-in">
      <AppLayout>
        <Head>
          <title>AI Connections | FibreFlow</title>
        </Head>
        <ConnectionsNav />
        <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
          <ProtectedPage permission="cortex.review" action="view">
            <CortexConnectionPanel revokeEnabled={revokeEnabled} />
          </ProtectedPage>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
