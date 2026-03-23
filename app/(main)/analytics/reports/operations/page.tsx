/**
 * Analytics Reports — Operations tab
 * 🟢 WORKING: Activations report — year/month/week drill-down table + bar chart
 */

export const dynamic = 'force-dynamic';

import ActivationsReport from '@/modules/analytics/reports/activations/ActivationsReport';

export default function OperationsReportsPage() {
  return <ActivationsReport />;
}
