/**
 * Bottlenecks Card Component
 */

import { AlertTriangle, CheckCircle2 } from 'lucide-react';

interface BottlenecksCardProps {
  bottlenecks: string[];
}

export function BottlenecksCard({ bottlenecks }: BottlenecksCardProps) {
  return (
    <div className="bg-background rounded-lg p-6 border border-border">
      <h3 className="text-lg font-medium text-foreground mb-4">
        Common Bottlenecks
      </h3>

      <div className="space-y-3">
        {bottlenecks.map((bottleneck, index) => (
          <div key={index} className="flex items-center space-x-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {bottleneck}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Affects multiple project phases
              </p>
            </div>
          </div>
        ))}
      </div>

      {bottlenecks.length === 0 && (
        <div className="text-center py-8">
          <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            No significant bottlenecks detected
          </p>
        </div>
      )}
    </div>
  );
}
