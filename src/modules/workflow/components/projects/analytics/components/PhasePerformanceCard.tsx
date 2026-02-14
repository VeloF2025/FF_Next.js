/**
 * Phase Performance Card Component
 */

import { AlertTriangle } from 'lucide-react';
import type { WorkflowAnalytics } from '../../../../types/workflow.types';

interface PhasePerformanceCardProps {
  phaseMetrics: WorkflowAnalytics['phaseMetrics'];
}

export function PhasePerformanceCard({ phaseMetrics }: PhasePerformanceCardProps) {
  return (
    <div className="bg-background rounded-lg p-6 border border-border">
      <h3 className="text-lg font-medium text-foreground mb-4">
        Phase Performance
      </h3>

      <div className="space-y-4">
        {phaseMetrics.slice(0, 6).map((phase, index) => (
          <div key={index} className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className={`w-2 h-2 rounded-full ${
                (phase.bottleneckRisk as string) === 'high' ? 'bg-red-500' : 'bg-green-500'
              }`} />
              <span className="text-sm font-medium text-foreground">
                {phase.phaseName}
              </span>
            </div>

            <div className="flex items-center space-x-4 text-sm text-muted-foreground">
              <span>{Math.round(phase.averageDuration)} days</span>
              <span>{Math.round(phase.completionRate)}%</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-border">
        <div className="flex items-center text-sm text-muted-foreground">
          <AlertTriangle className="w-4 h-4 text-yellow-600 mr-2" />
          <span>
            {phaseMetrics.filter(p => (p.bottleneckRisk as string) === 'high').length} phases need attention
          </span>
        </div>
      </div>
    </div>
  );
}
