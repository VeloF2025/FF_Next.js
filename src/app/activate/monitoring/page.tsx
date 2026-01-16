/**
 * DR Photo Unified - Rollout Monitoring Page
 *
 * Phase 6: Dashboard to track gradual rollout metrics
 * Accessible at /activate/monitoring
 */

'use client';

import { AppLayout } from '@/components/layout';
import { RolloutMonitoringDashboard } from '@/modules/activate/components/RolloutMonitoringDashboard';

export default function DrPhotoUnifiedMonitoringPage() {
  return (
    <AppLayout>
      <RolloutMonitoringDashboard />
    </AppLayout>
  );
}
