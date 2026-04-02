/**
 * GaugeChart - Circular progress gauge with target
 */

'use client';

export interface GaugeChartProps {
  value: number;
  target?: number;
  label: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function GaugeChart({
  value,
  target = 100,
  label,
  color = '#3B82F6',
  size = 'md',
}: GaugeChartProps) {
  const sizes = {
    sm: { width: 80, stroke: 8 },
    md: { width: 120, stroke: 10 },
    lg: { width: 160, stroke: 12 },
  };

  const { width, stroke } = sizes[size];
  const radius = (width - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const percentage = Math.min(100, Math.max(0, value));
  const offset = circumference - (percentage / 100) * circumference;

  // Determine color based on value vs target
  const getColor = () => {
    if (value >= target) return '#10B981'; // green
    if (value >= target * 0.8) return '#D97706'; // yellow
    return '#EF4444'; // red
  };

  const fillColor = color === 'auto' ? getColor() : color;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width, height: width }}>
        {/* Background circle */}
        <svg className="transform -rotate-90" width={width} height={width}>
          <circle
            cx={width / 2}
            cy={width / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            className="text-gray-200 dark:text-muted-foreground"
          />
          {/* Progress circle */}
          <circle
            cx={width / 2}
            cy={width / 2}
            r={radius}
            fill="none"
            stroke={fillColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-500"
          />
          {/* Target marker */}
          {target !== undefined && target < 100 && (
            <circle
              cx={width / 2}
              cy={width / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeDasharray={`2 ${circumference - 2}`}
              strokeDashoffset={-((target / 100) * circumference)}
              className="text-gray-400 dark:text-muted-foreground"
            />
          )}
        </svg>
        {/* Center value */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={`font-bold ${
              size === 'sm'
                ? 'text-lg'
                : size === 'md'
                  ? 'text-2xl'
                  : 'text-3xl'
            }`}
            style={{ color: fillColor }}
          >
            {value}%
          </span>
        </div>
      </div>
      <span className="mt-2 text-sm font-medium text-muted-foreground">
        {label}
      </span>
      {target !== undefined && target !== 100 && (
        <span className="text-xs text-muted-foreground">
          Target: {target}%
        </span>
      )}
    </div>
  );
}
