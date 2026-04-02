/**
 * FunnelChart - Visual funnel for workflow stages
 */

'use client';

import { defaultColors } from './chartColors';

export interface FunnelStage {
  name: string;
  value: number;
  percentage: number;
  color?: string;
}

export interface FunnelChartProps {
  stages: FunnelStage[];
  height?: number;
  title?: string;
  isLoading?: boolean;
}

export function FunnelChart({
  stages,
  height = 300,
  title,
  isLoading,
}: FunnelChartProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {title && (
          <div className="h-6 bg-secondary rounded w-48 animate-pulse" />
        )}
        <div
          className="bg-secondary rounded-lg animate-pulse"
          style={{ height }}
        />
      </div>
    );
  }

  if (!stages || stages.length === 0) {
    return (
      <div className="space-y-2">
        {title && (
          <h3 className="text-lg font-semibold text-foreground">
            {title}
          </h3>
        )}
        <div
          className="flex items-center justify-center bg-input/50 rounded-lg border border-border"
          style={{ height }}
        >
          <p className="text-muted-foreground">No funnel data</p>
        </div>
      </div>
    );
  }

  const maxValue = stages[0]?.value || 1;

  return (
    <div className="space-y-3">
      {title && (
        <h3 className="text-lg font-semibold text-foreground">
          {title}
        </h3>
      )}
      <div className="space-y-2">
        {stages.map((stage, idx) => {
          const width = Math.max(20, (stage.value / maxValue) * 100);
          const color = stage.color || defaultColors[idx % defaultColors.length];

          return (
            <div key={stage.name} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">
                  {stage.name}
                </span>
                <span className="text-muted-foreground">
                  {stage.value.toLocaleString()} ({stage.percentage}%)
                </span>
              </div>
              <div className="relative">
                <div
                  className="h-8 rounded transition-all duration-300 flex items-center justify-center"
                  style={{
                    width: `${width}%`,
                    backgroundColor: color,
                    marginLeft: `${(100 - width) / 2}%`,
                  }}
                >
                  <span className="text-white text-xs font-medium">
                    {stage.percentage}%
                  </span>
                </div>
                {idx < stages.length - 1 && (
                  <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2">
                    <svg
                      className="w-4 h-2 text-gray-300 dark:text-muted-foreground"
                      viewBox="0 0 16 8"
                    >
                      <path d="M0 0 L8 8 L16 0" fill="currentColor" />
                    </svg>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
