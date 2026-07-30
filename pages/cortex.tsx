import Head from 'next/head';
import Link from 'next/link';
import { AppLayout } from '@/components/layout/AppLayout';
import { PermissionGate } from '@/components/PermissionGate';
import { CortexHero } from '@/components/cortex/CortexHero';
import { CortexReviewPanel } from '@/components/cortex/CortexReviewPanel';
import { CortexCitedSearch } from '@/components/cortex/CortexCitedSearch';

export default function CortexPage() {
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

          <PermissionGate
            permission="cortex.review"
            action="view"
            showLoading
          >
            <Link href="/connections/cortex">
              Manage AI Connections
            </Link>
          </PermissionGate>

          <CortexCitedSearch />
          <CortexReviewPanel />
        </div>
      </div>
    </AppLayout>
  );
}
