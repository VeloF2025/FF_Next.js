/**
 * Success Factors Card Component
 */

import { Target, Users, BarChart3 } from 'lucide-react';

export function SuccessFactorsCard() {
  return (
    <div className="bg-background rounded-lg p-6 border border-border">
      <h3 className="text-lg font-medium text-foreground mb-4">
        Success Factors
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="text-center">
          <div className="w-12 h-12 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mx-auto mb-3">
            <Target className="w-6 h-6 text-green-600 dark:text-green-400" />
          </div>
          <h4 className="text-sm font-medium text-foreground mb-1">
            Clear Objectives
          </h4>
          <p className="text-xs text-muted-foreground">
            Templates with defined success criteria perform 23% better
          </p>
        </div>

        <div className="text-center">
          <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/20 rounded-full flex items-center justify-center mx-auto mb-3">
            <Users className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <h4 className="text-sm font-medium text-foreground mb-1">
            Team Experience
          </h4>
          <p className="text-xs text-muted-foreground">
            Experienced teams complete workflows 18% faster
          </p>
        </div>

        <div className="text-center">
          <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/20 rounded-full flex items-center justify-center mx-auto mb-3">
            <BarChart3 className="w-6 h-6 text-purple-600 dark:text-purple-400" />
          </div>
          <h4 className="text-sm font-medium text-foreground mb-1">
            Regular Monitoring
          </h4>
          <p className="text-xs text-muted-foreground">
            Daily progress tracking reduces delays by 31%
          </p>
        </div>
      </div>
    </div>
  );
}
