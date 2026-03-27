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

const COLOR_MAP: Record<string, string> = {
  red: 'bg-red-500/10 text-red-500 border-red-500/30',
  orange: 'bg-orange-500/10 text-orange-500 border-orange-500/30',
  amber: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  yellow: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30',
  green: 'bg-green-500/10 text-green-500 border-green-500/30',
  blue: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
  purple: 'bg-purple-500/10 text-purple-500 border-purple-500/30',
};

export function CAPAStatusBadge({ status }: { status: CAPAStatus }) {
  const config = CAPA_STATUS_CONFIG[status];
  if (!config) return null;
  const cls = COLOR_MAP[config.color] || COLOR_MAP.blue;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${cls}`}>
      {config.label}
    </span>
  );
}

export function CAPASeverityBadge({ severity }: { severity: CAPASeverity }) {
  const config = CAPA_SEVERITY_CONFIG[severity];
  if (!config) return null;
  const cls = COLOR_MAP[config.color] || COLOR_MAP.blue;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${cls}`}>
      {config.label}
    </span>
  );
}
