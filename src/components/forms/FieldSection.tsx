import React from 'react';

interface FieldSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
  columns?: 1 | 2 | 3 | 4;
  className?: string;
}

/**
 * Consistent section component for grouping related fields
 * Ensures uniform layout across all module views
 */
export function FieldSection({
  title,
  description,
  children,
  icon,
  columns = 1,
  className = ''
}: FieldSectionProps) {
  const gridClass = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
  }[columns];

  return (
    <div className={`bg-card rounded-lg border border-border p-6 ${className}`}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-foreground flex items-center">
          {icon && <span className="mr-2">{icon}</span>}
          {title}
        </h3>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      
      <div className={`grid ${gridClass} gap-4`}>
        {children}
      </div>
    </div>
  );
}

/**
 * Container for multiple sections
 */
export function FieldSectionContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      {children}
    </div>
  );
}