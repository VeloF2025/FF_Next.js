import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { PermissionGate } from '@/components/PermissionGate';
import { CortexHero } from '@/components/cortex/CortexHero';
import { CortexReviewPanel } from '@/components/cortex/CortexReviewPanel';
import { CortexCitedSearch } from '@/components/cortex/CortexCitedSearch';
import { CortexConnectPanel } from '@/components/cortex/CortexConnectPanel';
import { FibreFlowConnectionPanel as FibreFlowConnectPanel } from '@/components/connections/FibreFlowConnectionPanel';

export default function CortexPage({
  mcpEnabled,
  ffMcpEnabled,
}: {
  mcpEnabled: boolean;
  ffMcpEnabled: boolean;
}) {
  return (
    <AppLayout>
      <Head>
        <title>Cortex | FibreFlow</title>
      </Head>
      {/* Premium "Cortex landing" surface — scoped dark+gold skin (styles/cortex-premium.css).
          Forced dark for this subtree regardless of the app's light/dark theme. */}
      <div className="cortex-premium min-h-full px-6 py-8 sm:px-8">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-8">
          <CortexHero />

          {mcpEnabled && (
            // showLoading keeps the gate CLOSED while permissions are still fetching —
            // usePermission optimistically allows 'view' before hasFetched, which would
            // otherwise flash this credential panel to a user who lacks cortex.review.
            <PermissionGate permission="cortex.review" action="view" showLoading>
              <CortexConnectPanel />
            </PermissionGate>
          )}

          {/* No PermissionGate: a read-only FibreFlow token grants nothing beyond what
              the signed-in user can already see in the app. */}
          {ffMcpEnabled && <FibreFlowConnectPanel />}

          <CortexCitedSearch />
          <CortexReviewPanel />
        </div>
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
  const ffMcpEnabled =
    (process.env.FF_MCP_TOKEN_UI_ENABLED ?? '').trim().toLowerCase() === 'true';
  return { props: { mcpEnabled, ffMcpEnabled } };
};
