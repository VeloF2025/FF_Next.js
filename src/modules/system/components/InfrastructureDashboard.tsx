/**
 * Infrastructure Dashboard Component
 *
 * Displays detailed service status with grouping by category,
 * health history, and recovery action configuration.
 */

import React, { useState, useEffect } from 'react';
import {
  Server,
  Cpu,
  MessageSquare,
  Database,
  Settings,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Wrench,
} from 'lucide-react';
import type { ServiceDefinition, ServiceHealth, ServiceCategory } from '../types/self-healing.types';
import { log } from '@/lib/logger';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface ServiceWithHealth extends ServiceDefinition {
  health?: ServiceHealth;
  recoveryActions?: Array<{
    id: string;
    actionName: string;
    riskLevel: string;
    successCount: number;
    failureCount: number;
  }>;
}

interface ServicesData {
  services: ServiceWithHealth[];
  count: number;
  byCategory: Record<ServiceCategory, number>;
}

const CATEGORY_CONFIG: Record<
  ServiceCategory,
  { label: string; icon: React.ElementType; color: string }
> = {
  app: { label: 'Applications', icon: Server, color: 'text-blue-400' },
  ai: { label: 'AI Services', icon: Cpu, color: 'text-purple-400' },
  messaging: { label: 'Messaging', icon: MessageSquare, color: 'text-green-400' },
  database: { label: 'Databases', icon: Database, color: 'text-yellow-400' },
  infrastructure: { label: 'Infrastructure', icon: Settings, color: 'text-gray-400' },
};

export default function InfrastructureDashboard() {
  const [data, setData] = useState<ServicesData | null>(null);
  const [healthData, setHealthData] = useState<Record<string, ServiceHealth>>({});
  const [loading, setLoading] = useState(true);
  const [expandedCategories, setExpandedCategories] = useState<Set<ServiceCategory>>(
    new Set(['app', 'ai', 'messaging'])
  );
  const [expandedService, setExpandedService] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [servicesRes, healthRes] = await Promise.all([
        fetch('/api/system/services'),
        fetch('/api/system/self-healing'),
      ]);

      if (!servicesRes.ok || !healthRes.ok) throw new Error('Failed to fetch');

      const servicesResult = await servicesRes.json();
      const healthResult = await healthRes.json();

      setData(servicesResult.data);

      // Map health data by service ID
      const healthMap: Record<string, ServiceHealth> = {};
      healthResult.data?.health?.services?.forEach((s: ServiceHealth) => {
        healthMap[s.serviceId] = s;
      });
      setHealthData(healthMap);
    } catch (err) {
      log.error('Failed to load infrastructure data', { error: err }, 'InfrastructureDashboard');
    } finally {
      setLoading(false);
    }
  };

  const toggleCategory = (category: ServiceCategory) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-red-900/20 border border-red-500 rounded-lg p-4">
        <p className="text-red-400">Failed to load infrastructure data</p>
      </div>
    );
  }

  // Group services by category
  const grouped = data.services.reduce(
    (acc, service) => {
      if (!acc[service.category]) acc[service.category] = [];
      acc[service.category].push(service);
      return acc;
    },
    {} as Record<ServiceCategory, ServiceWithHealth[]>
  );

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-5 gap-4">
        {Object.entries(CATEGORY_CONFIG).map(([category, config]) => {
          const count = data.byCategory[category as ServiceCategory] || 0;
          const Icon = config.icon;

          return (
            <div key={category} className="bg-gray-800 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <Icon className={`w-5 h-5 ${config.color}`} />
                <span className="text-sm text-gray-400">{config.label}</span>
              </div>
              <p className="text-2xl font-semibold text-white mt-1">{count}</p>
            </div>
          );
        })}
      </div>

      {/* Category Groups */}
      {Object.entries(CATEGORY_CONFIG).map(([category, config]) => {
        const services = grouped[category as ServiceCategory] || [];
        if (services.length === 0) return null;

        const Icon = config.icon;
        const isExpanded = expandedCategories.has(category as ServiceCategory);

        return (
          <div key={category} className="bg-gray-800 rounded-lg overflow-hidden">
            {/* Category Header */}
            <button
              onClick={() => toggleCategory(category as ServiceCategory)}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-700/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-5 h-5 ${config.color}`} />
                <span className="text-lg font-medium text-white">{config.label}</span>
                <span className="text-sm text-muted-foreground">({services.length})</span>
              </div>
              {isExpanded ? (
                <ChevronDown className="w-5 h-5 text-gray-400" />
              ) : (
                <ChevronRight className="w-5 h-5 text-gray-400" />
              )}
            </button>

            {/* Services List */}
            {isExpanded && (
              <div className="border-t border-gray-700">
                {services.map((service) => (
                  <ServiceRow
                    key={service.id}
                    service={service}
                    health={healthData[service.id]}
                    isExpanded={expandedService === service.id}
                    onToggle={() =>
                      setExpandedService(expandedService === service.id ? null : service.id)
                    }
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ServiceRow({
  service,
  health,
  isExpanded,
  onToggle,
}: {
  service: ServiceWithHealth;
  health?: ServiceHealth;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const status = health?.status || 'unknown';

  const statusConfig = {
    healthy: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-400' },
    degraded: { icon: AlertCircle, color: 'text-yellow-400', bg: 'bg-yellow-400' },
    unhealthy: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-400' },
    timeout: { icon: Clock, color: 'text-orange-400', bg: 'bg-orange-400' },
    error: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-400' },
    unknown: { icon: AlertCircle, color: 'text-gray-400', bg: 'bg-gray-400' },
  }[status];

  const StatusIcon = statusConfig.icon;

  return (
    <div className="border-b border-gray-700 last:border-b-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-700/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${statusConfig.bg}`} />
          <span className="text-white">{service.name}</span>
          {service.isCritical && (
            <span className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded">CRITICAL</span>
          )}
          {!service.isEnabled && (
            <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded">DISABLED</span>
          )}
        </div>

        <div className="flex items-center gap-4">
          {health?.responseTimeMs && (
            <span className="text-sm text-muted-foreground">{health.responseTimeMs}ms</span>
          )}
          <StatusIcon className={`w-4 h-4 ${statusConfig.color}`} />
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </button>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 bg-gray-700/20">
          {/* Service Details */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Health Check</span>
              <p className="text-gray-300">{service.healthCheckType}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Timeout</span>
              <p className="text-gray-300">{service.timeoutMs}ms</p>
            </div>
            <div>
              <span className="text-muted-foreground">Recovery</span>
              <p className="text-gray-300">{service.recoveryEnabled ? 'Enabled' : 'Disabled'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Cooldown</span>
              <p className="text-gray-300">{service.cooldownMinutes}min</p>
            </div>
          </div>

          {/* Endpoint */}
          {service.healthEndpoint && (
            <div className="text-sm">
              <span className="text-muted-foreground">Endpoint: </span>
              <code className="text-gray-300 bg-gray-800 px-2 py-0.5 rounded">
                {service.healthEndpoint}
              </code>
            </div>
          )}

          {/* Recovery Actions */}
          {service.recoveryActions && service.recoveryActions.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Wrench className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-400">Recovery Actions</span>
              </div>
              <div className="space-y-1">
                {service.recoveryActions.map((action) => (
                  <div
                    key={action.id}
                    className="flex items-center justify-between bg-gray-800 rounded p-2"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          action.riskLevel === 'safe'
                            ? 'bg-green-900 text-green-300'
                            : action.riskLevel === 'moderate'
                              ? 'bg-yellow-900 text-yellow-300'
                              : 'bg-red-900 text-red-300'
                        }`}
                      >
                        {action.riskLevel}
                      </span>
                      <span className="text-sm text-gray-300">{action.actionName}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-green-400">{action.successCount} ✓</span>
                      <span className="text-red-400">{action.failureCount} ✗</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
