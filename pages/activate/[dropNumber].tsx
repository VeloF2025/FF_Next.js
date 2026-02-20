/**
 * Legacy DR review route — redirects to canonical QA Centre detail page
 * /activate/[dropNumber] → /activate/qa-centre/[dropNumber]
 */

import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';

export default function DrPhotoUnifiedDetailPage() {
  const router = useRouter();
  const { dropNumber } = router.query;

  useEffect(() => {
    if (dropNumber) {
      router.replace(`/activate/qa-centre/${dropNumber}`);
    }
  }, [dropNumber, router]);

  return (
    <AppLayout>
      <div className="flex h-64 items-center justify-center">
        <div className="text-gray-500">Redirecting...</div>
      </div>
    </AppLayout>
  );
}
