/**
 * StoreTile — reusable card-style button for the Stores hub.
 *
 * Renders an icon + title + subtitle. Optional `badge` numeric badge
 * (top-right) used by the Today-summary tile when there are unaccounted
 * serials. Disabled tiles get a dimmer treatment and ignore clicks.
 */

import React from 'react';

export interface StoreTileProps {
  icon: React.ReactNode;
  iconClass: string;
  title: string;
  subtitle: string;
  onClick?: () => void;
  disabled?: boolean;
  fullWidth?: boolean;
  /** Optional badge number rendered at top-right when > 0. */
  badge?: number;
}

export function StoreTile({
  icon,
  iconClass,
  title,
  subtitle,
  onClick,
  disabled = false,
  fullWidth = false,
  badge,
}: StoreTileProps) {
  const baseClass = [
    'rounded-2xl border border-neutral-800 bg-neutral-900 p-4 text-left',
    'transition-colors min-h-[110px] flex flex-col gap-2',
    fullWidth ? 'w-full' : '',
    disabled
      ? 'opacity-50 pointer-events-none cursor-not-allowed'
      : 'hover:bg-neutral-800/80 active:bg-neutral-800 cursor-pointer',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`relative ${baseClass}`}
    >
      <span
        className={`flex w-10 h-10 items-center justify-center rounded-xl ${iconClass}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div>
        <div className="text-sm font-semibold text-neutral-100">{title}</div>
        <div className="text-xs text-neutral-400 mt-0.5">{subtitle}</div>
      </div>
      {typeof badge === 'number' && badge > 0 && (
        <span
          aria-label={`${badge} unaccounted`}
          className="absolute top-3 right-3 inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded-full bg-red-500 text-white text-xs font-semibold"
        >
          {badge}
        </span>
      )}
    </button>
  );
}
