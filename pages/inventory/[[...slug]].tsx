/**
 * Catch-all redirect from old /inventory/* routes to new /assets/*
 *
 * This preserves any bookmarks or links to the old URLs.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function InventoryRedirect() {
  const router = useRouter();

  useEffect(() => {
    // Replace /inventory with /assets in the current path
    const newPath = router.asPath.replace('/inventory', '/assets');
    router.replace(newPath);
  }, [router]);

  return null;
}
