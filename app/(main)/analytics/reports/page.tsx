/**
 * Analytics Reports — redirects to /analytics/reports/financial
 */

import { redirect } from 'next/navigation';

export default function ReportsPage() {
  redirect('/analytics/reports/financial');
}
