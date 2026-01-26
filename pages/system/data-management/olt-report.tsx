/**
 * OLT Report Redirect
 *
 * Redirects to the unified Data Sync page under /system/data-sync
 * Preserves backward compatibility with old URL and tab parameter.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function OltReportRedirect() {
  const router = useRouter();

  useEffect(() => {
    // Preserve tab parameter if present
    const { tab } = router.query;
    const targetUrl = tab
      ? `/system/data-sync?group=olt&tab=${tab}`
      : '/system/data-sync?group=olt';

    router.replace(targetUrl);
  }, [router]);

  // Show nothing while redirecting
  return null;
}
