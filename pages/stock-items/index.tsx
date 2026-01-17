/**
 * Redirect from old /stock-items route to new /procurement/stock-items
 */
import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function StockItemsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/procurement/stock-items');
  }, [router]);

  return null;
}
