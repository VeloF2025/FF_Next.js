/**
 * CAPA Status Badge - Colored badge for CAPA status/severity
 */

import React from 'react';
import {
  CAPA_STATUS_CONFIG,
  CAPA_SEVERITY_CONFIG,
  type CAPAStatus,
  type CAPASeverity,
} from '@/modules/health-safety/types/capa.types';

// Token-based colour map — uses semantic CSS variables for theme compatibility
// Inline style required for exact token values; Tailwind classes provide fallback bg/border
const COLOR_MAP: Record<string, { className: string; style: React.CSSProperties }> = {
  red:    { className: 'border', style: { background: 'color-mix(in srgb, var(--ff-danger) 12%, transparent)', color: 'var(--ff-danger)', borderColor: 'color-mix(in srgb, var(--ff-danger) 30%, transparent)' } },
  orange: { className: 'border', style: { background: 'color-mix(in srgb, var(--ff-warning) 12%, transparent)', color: 'var(--ff-warning)', borderColor: 'color-mix(in srgb, var(--ff-warning) 30%, transparent)' } },
  amber:  { className: 'border', style: { background: 'color-mix(in srgb, var(--ff-warning) 12%, transparent)', color: 'var(--ff-warning)', borderColor: 'color-mix(in srgb, var(--ff-warning) 30%, transparent)' } },
  yellow: { className: 'border', style: { background: 'color-mix(in srgb, var(--ff-warning) 12%, transparent)', color: 'var(--ff-warning)', borderColor: 'color-mix(in srgb, var(--ff-warning) 30%, transparent)' } },
  green:  { className: 'border', style: { background: 'color-mix(in srgb, var(--ff-success) 12%, transparent)', color: 'var(--ff-success)', borderColor: 'color-mix(in srgb, var(--ff-success) 30%, transparent)' } },
  blue:   { className: 'border', style: { background: 'color-mix(in srgb, var(--ff-primary) 12%, transparent)', color: 'var(--ff-primary)', borderColor: 'color-mix(in srgb, var(--ff-primary) 30%, transparent)' } },
  purple: { className: 'border', style: { background: 'color-mix(in srgb, var(--ff-accent) 12%, transparent)', color: 'var(--ff-accent)', borderColor: 'color-mix(in srgb, var(--ff-accent) 30%, transparent)' } },
};

export function CAPAStatusBadge({ status }: { status: CAPAStatus }) {
  const config = CAPA_STATUS_CONFIG[status];
  if (!config) return null;
  const token = COLOR_MAP[config.color] ?? COLOR_MAP['blue']!;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${token.className}`}
      style={token.style}
    >
      {config.label}
    </span>
  );
}

export function CAPASeverityBadge({ severity }: { severity: CAPASeverity }) {
  const config = CAPA_SEVERITY_CONFIG[severity];
  if (!config) return null;
  const token = COLOR_MAP[config.color] ?? COLOR_MAP['blue']!;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${token.className}`}
      style={token.style}
    >
      {config.label}
    </span>
  );
}
