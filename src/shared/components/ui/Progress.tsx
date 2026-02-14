import React from 'react';
import { clsx } from 'clsx';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  color?: 'blue' | 'green' | 'yellow' | 'red' | 'purple';
}

export function Progress({
  value,
  max = 100,
  size = 'md',
  color = 'blue',
  className,
  ...props
}: ProgressProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  const sizeStyles = {
    sm: 'h-1',
    md: 'h-2',
    lg: 'h-3',
  };

  const colorStyles = {
    blue: 'bg-blue-600',
    green: 'bg-green-600',
    yellow: 'bg-yellow-600',
    red: 'bg-red-600',
    purple: 'bg-purple-600',
  };

  return (
    <div
      className={clsx(
        'relative w-full overflow-hidden rounded-full bg-secondary',
        sizeStyles[size],
        className
      )}
      {...props}
    >
      <div
        className={clsx(
          'h-full transition-all duration-300 ease-in-out',
          colorStyles[color]
        )}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}