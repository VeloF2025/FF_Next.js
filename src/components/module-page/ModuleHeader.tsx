/**
 * ModuleHeader Component
 * Renders module title, description, icon, and actions
 * Uses FibreFlow Design System CSS variables
 */

'use client';

import React from 'react';
import type { ModuleHeaderProps } from './types';

export function ModuleHeader({
  title,
  description,
  icon: Icon,
  actions,
}: ModuleHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="p-2 rounded-lg bg-[var(--ff-primary-500)]/10">
            <Icon className="h-6 w-6 text-[var(--ff-primary-500)]" />
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-[var(--ff-text-secondary)]">
              {description}
            </p>
          )}
        </div>
      </div>

      {actions && (
        <div className="flex items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

export default ModuleHeader;
