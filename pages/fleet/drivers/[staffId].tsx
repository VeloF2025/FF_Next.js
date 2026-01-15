/**
 * Fleet Driver Scorecard Redirect
 * Redirects old URLs to new tab structure for backwards compatibility
 */

import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function DriverScorecardRedirect() {
  const router = useRouter();
  const { staffId } = router.query;

  useEffect(() => {
    if (router.isReady && staffId) {
      // Redirect to new tab structure
      router.replace(`/fleet/drivers?tab=scorecards&staffId=${staffId}`);
    }
  }, [router.isReady, staffId, router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--ff-bg-primary)]">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--ff-primary)] mx-auto mb-4"></div>
        <p className="text-[var(--ff-text-secondary)]">Redirecting...</p>
      </div>
    </div>
  );
}
