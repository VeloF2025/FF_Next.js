import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { CortexReviewPanel } from '@/components/cortex/CortexReviewPanel';
import { CortexCitedSearch } from '@/components/cortex/CortexCitedSearch';

export default function CortexPage() {
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
        <div className="mb-6">
          <CortexCitedSearch />
        </div>
        <CortexReviewPanel />
      </div>
    </AppLayout>
  );
}

// Auth enforced client-side via AppLayout — consistent with other non-sensitive pages.
export const getServerSideProps = async () => {
  return { props: {} };
};
