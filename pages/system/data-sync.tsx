/**
 * Data Sync Page - Redirects to /activate/data-sync
 * Kept for backwards compatibility with bookmarks/links.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function DataSyncRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/activate/data-sync');
  }, [router]);

  return null;
}
