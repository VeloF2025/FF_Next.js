import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { PermissionGate } from '@/components/PermissionGate';
import { CortexReviewPanel } from '@/components/cortex/CortexReviewPanel';
import { CortexCitedSearch } from '@/components/cortex/CortexCitedSearch';
import { CortexConnectPanel } from '@/components/cortex/CortexConnectPanel';

export default function CortexPage({ mcpEnabled }: { mcpEnabled: boolean }) {
  return (
    <AppLayout>
      <Head>
        <title>Cortex | FibreFlow</title>
      </Head>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[var(--ff-text-primary)]">Cortex</h1>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            AI-enriched communications and meeting intelligence pending your review
          </p>
        </div>
        {mcpEnabled && (
          // showLoading keeps the gate CLOSED while permissions are still fetching —
          // usePermission optimistically allows 'view' before hasFetched, which would
          // otherwise flash this credential panel to a user who lacks cortex.review.
          <PermissionGate permission="cortex.review" action="view" showLoading>
            <div className="mb-6">
              <CortexConnectPanel />
            </div>
          </PermissionGate>
        )}
        <div className="mb-6">
          <CortexCitedSearch />
        </div>
        <CortexReviewPanel />
      </div>
    </AppLayout>
  );
}

// Auth enforced client-side via AppLayout — consistent with other non-sensitive pages.
// The MCP connect panel is additionally gated server-side by CORTEX_MCP_TOKEN_UI_ENABLED
// (so it stays hidden until the feature is flipped on) and client-side by cortex.review.
export const getServerSideProps = async () => {
  const mcpEnabled =
    (process.env.CORTEX_MCP_TOKEN_UI_ENABLED ?? '').trim().toLowerCase() === 'true';
  return { props: { mcpEnabled } };
};
