/**
 * Analytics Reports — Financial sub-page
 * Gated by analytics.reports.financial RBAC key.
 * 🟢 WORKING: Renders all financial report cards
 */

export const dynamic = 'force-dynamic';

import FinancialReportsClient from './client';

export default function FinancialReportsPage() {
  // Auth + RBAC is enforced client-side via usePermission in the layout tab filter,
  // and server-side at the API routes. No server session available in App Router
  // without next-auth — client component handles redirect if tab is hidden.
  return <FinancialReportsClient />;
}
