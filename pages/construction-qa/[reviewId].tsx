/**
 * Construction QA Review Detail Page
 * Shows the 5-phase QA wizard for a single feature review.
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { constructionQaConfig } from '@/modules/navigation';
import { ReviewWizard } from '@/modules/construction-qa/components/wizard/ReviewWizard';

const ReviewDetailPage: NextPage = () => {
  const router = useRouter();
  const { reviewId } = router.query;

  return (
    <AppLayout>
      <Head>
        <title>Review Detail | Civil QA | FibreFlow</title>
      </Head>
      <ModulePage config={constructionQaConfig}>
        {reviewId && typeof reviewId === 'string' ? (
          <ReviewWizard reviewId={reviewId} />
        ) : (
          <div className="text-center text-gray-500 py-12">Loading...</div>
        )}
      </ModulePage>
    </AppLayout>
  );
};

export default ReviewDetailPage;
