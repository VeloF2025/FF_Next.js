/**
 * Service Status Card Component
 * Displays health status for a single service with color-coded indicators
 */

import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, HelpCircle, Clock } from 'lucide-react';
import type { ServiceStatus, ServiceStatusValue } from '../types/infrastructure.types';

interface ServiceStatusCardProps {
  name: string;
  status: ServiceStatus;
  isCritical?: boolean;
  compact?: boolean;
}

const statusConfig: Record<ServiceStatusValue, {
  icon: React.ElementType;
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
}> = {
  up: {
    icon: CheckCircle2,
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/20',
    label: 'UP',
  },
  down: {
    icon: XCircle,
    color: 'text-red-500',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/20',
    label: 'DOWN',
  },
  degraded: {
    icon: AlertTriangle,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/10',
    borderColor: 'border-yellow-500/20',
    label: 'DEGRADED',
  },
  unknown: {
    icon: HelpCircle,
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/10',
    borderColor: 'border-gray-500/20',
    label: 'UNKNOWN',
  },
};

export function ServiceStatusCard({
  name,
  status,
  isCritical = false,
  compact = false,
}: ServiceStatusCardProps) {
  const config = statusConfig[status.status];
  const Icon = config.icon;

  if (compact) {
    return (
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${config.bgColor} ${config.borderColor}`}
        title={status.message || status.error || config.label}
      >
        <Icon className={`w-4 h-4 ${config.color}`} />
        <span className="text-sm font-medium text-white/90">{name}</span>
        {status.latencyMs !== null && (
          <span className="text-xs text-white/50">{status.latencyMs}ms</span>
        )}
      </div>
    );
  }

  return (
    <div
      className={`relative flex flex-col p-4 rounded-xl border transition-all duration-200 hover:scale-[1.02] ${config.bgColor} ${config.borderColor}`}
    >
      {isCritical && (
        <div className="absolute -top-2 -right-2 px-2 py-0.5 text-[10px] font-bold text-red-400 bg-red-500/20 rounded-full border border-red-500/30">
          CRITICAL
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-white/90">{name}</span>
        <Icon className={`w-5 h-5 ${config.color}`} />
      </div>

      <div className="flex items-center gap-2">
        <span className={`text-xs font-bold ${config.color}`}>{config.label}</span>
        {status.latencyMs !== null && (
          <span className="flex items-center gap-1 text-xs text-white/50">
            <Clock className="w-3 h-3" />
            {status.latencyMs}ms
          </span>
        )}
      </div>

      {(status.message || status.error) && (
        <p className="mt-2 text-xs text-white/50 line-clamp-2">
          {status.message || status.error}
        </p>
      )}
    </div>
  );
}

export default ServiceStatusCard;
