/**
 * Template Usage Chart Component
 */

import type { WorkflowAnalytics } from '../../../../types/workflow.types';

interface TemplateUsageChartProps {
  templateUsage: WorkflowAnalytics['templateUsage'];
}

export function TemplateUsageChart({ templateUsage }: TemplateUsageChartProps) {
  return (
    <div className="bg-background rounded-lg p-6 border border-border">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-foreground">
          Most Used Templates
        </h3>
        <span className="text-sm text-muted-foreground">
          Project count
        </span>
      </div>

      <div className="space-y-3">
        {templateUsage.slice(0, 5).map((template, index) => (
          <div key={template.templateId} className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 flex-1">
              <div className={`w-3 h-3 rounded-full ${
                index === 0 ? 'bg-blue-500' :
                index === 1 ? 'bg-green-500' :
                index === 2 ? 'bg-purple-500' :
                index === 3 ? 'bg-orange-500' : 'bg-gray-500'
              }`} />
              <span className="text-sm font-medium text-foreground truncate">
                {template.templateName}
              </span>
            </div>

            <div className="flex items-center space-x-4 text-sm">
              <span className="text-muted-foreground min-w-16 text-right">
                {template.projectCount} projects
              </span>
              <span className="text-muted-foreground min-w-20 text-right">
                {Math.round(template.successRate)}% success
              </span>
              <span className="text-muted-foreground min-w-20 text-right">
                {Math.round(template.averageDuration)} days avg
              </span>
            </div>

            <div className="w-24 bg-secondary rounded-full h-2">
              <div
                className={`h-2 rounded-full ${
                  index === 0 ? 'bg-blue-500' :
                  index === 1 ? 'bg-green-500' :
                  index === 2 ? 'bg-purple-500' :
                  index === 3 ? 'bg-orange-500' : 'bg-gray-500'
                }`}
                style={{
                  width: `${Math.min(100, (template.projectCount / templateUsage[0]?.projectCount) * 100)}%`
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
