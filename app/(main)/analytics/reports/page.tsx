/**
 * Analytics Reports Page — Server Component (force-dynamic)
 * Restricted internal use — renders the client-side reports sandbox.
 */

export const dynamic = 'force-dynamic';

import ReportsPageClient from './client';

export default function ReportsPage() {
  return <ReportsPageClient />;
}
