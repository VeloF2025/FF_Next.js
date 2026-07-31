import Head from 'next/head';

import { ConnectionsNav } from '@/components/connections/ConnectionsNav';
import { FibreFlowConnectionPanel } from '@/components/connections/FibreFlowConnectionPanel';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';

interface FibreFlowConnectionsPageProps {
  sessionsEnabled: boolean;
}

/**
 * Read the flag per request rather than at build time: one build is deployed to
 * both dev (flag on) and production (flag off), so baking it in would ship
 * production a dev-shaped page.
 */
export function getServerSideProps(): { props: FibreFlowConnectionsPageProps } {
  return {
    props: {
      sessionsEnabled:
        (process.env.FF_MCP_TOKEN_UI_ENABLED ?? '').trim().toLowerCase() === 'true',
    },
  };
}

export default function FibreFlowConnectionsPage({
  sessionsEnabled,
}: FibreFlowConnectionsPageProps) {
  return (
    <ProtectedRoute fallbackPath="/sign-in">
      <AppLayout>
        <Head>
          <title>AI Connections | FibreFlow</title>
        </Head>
        <ConnectionsNav />
        <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
          <FibreFlowConnectionPanel sessionsEnabled={sessionsEnabled} />
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
