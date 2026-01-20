/**
 * Services Tab - WhatsApp Service Status and Controls
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  Phone,
  Clock,
  RotateCcw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { waAdminApi } from '../services/waAdminApiService';
import type { WaServicesStatusResponse, WaServiceStatus, ServiceStatus } from '../types/wa-admin.types';

/* Services Tab - Displays WhatsApp Bridge and Sender service status with restart controls */

const ServicesTab: React.FC = () => {
  const [status, setStatus] = useState<WaServicesStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restartingService, setRestartingService] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await waAdminApi.services.status();

    if (result.success && result.data) {
      setStatus(result.data);
    } else {
      setError(result.error || 'Failed to fetch service status');
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStatus();

    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleRestart = async (service: 'bridge' | 'sender') => {
    if (restartingService) return;

    setRestartingService(service);

    const result = await waAdminApi.services.restart(service);

    if (result.success) {
      toast.success(`${service} service restart initiated`);
      // Wait a bit then refresh status
      setTimeout(() => {
        fetchStatus();
        setRestartingService(null);
      }, 3000);
    } else {
      toast.error(result.error || 'Failed to restart service');
      setRestartingService(null);
    }
  };

  const getStatusIcon = (serviceStatus: ServiceStatus) => {
    switch (serviceStatus) {
      case 'connected':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'disconnected':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'connecting':
        return <Loader2 className="w-5 h-5 text-yellow-500 animate-spin" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      default:
        return <AlertCircle className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusColor = (serviceStatus: ServiceStatus) => {
    switch (serviceStatus) {
      case 'connected':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'disconnected':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'connecting':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'error':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getOverallStatusBadge = (overall: 'healthy' | 'degraded' | 'down') => {
    switch (overall) {
      case 'healthy':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-green-100 text-green-800 text-sm font-medium">
            <CheckCircle className="w-4 h-4" /> All Systems Operational
          </span>
        );
      case 'degraded':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 text-sm font-medium">
            <AlertCircle className="w-4 h-4" /> Partial Outage
          </span>
        );
      case 'down':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-red-100 text-red-800 text-sm font-medium">
            <XCircle className="w-4 h-4" /> Services Down
          </span>
        );
    }
  };

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-label="Loading service status">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" aria-hidden="true" />
        <span className="sr-only">Loading service status...</span>
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="text-center py-12" role="alert">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" aria-hidden="true" />
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={fetchStatus}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with overall status and refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            Service Status
          </h3>
          {status && getOverallStatusBadge(status.overall)}
        </div>

        <button
          onClick={fetchStatus}
          disabled={loading}
          aria-label="Refresh service status"
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {/* Service Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {status && (
          <>
            <ServiceCard
              service={status.bridge}
              onRestart={() => handleRestart('bridge')}
              isRestarting={restartingService === 'bridge'}
              getStatusIcon={getStatusIcon}
              getStatusColor={getStatusColor}
            />
            <ServiceCard
              service={status.sender}
              onRestart={() => handleRestart('sender')}
              isRestarting={restartingService === 'sender'}
              getStatusIcon={getStatusIcon}
              getStatusColor={getStatusColor}
            />
          </>
        )}
      </div>

      {/* Last checked timestamp */}
      {status && (
        <p className="text-xs text-gray-500 text-right">
          Last checked: {new Date(status.checked_at).toLocaleString()}
        </p>
      )}
    </div>
  );
};

interface ServiceCardProps {
  service: WaServiceStatus;
  onRestart: () => void;
  isRestarting: boolean;
  getStatusIcon: (status: ServiceStatus) => React.ReactNode;
  getStatusColor: (status: ServiceStatus) => string;
}

const ServiceCard: React.FC<ServiceCardProps> = ({
  service,
  onRestart,
  isRestarting,
  getStatusIcon,
  getStatusColor,
}) => {
  return (
    <div className="border border-[var(--ff-border-light)] rounded-lg p-4 sm:p-5 bg-white">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          {getStatusIcon(service.status)}
          <div>
            <h4 className="font-semibold text-[var(--ff-text-primary)]">
              {service.displayName}
            </h4>
            <span className={`text-xs px-2 py-0.5 rounded border ${getStatusColor(service.status)}`}>
              {service.status.toUpperCase()}
            </span>
          </div>
        </div>

        <button
          onClick={onRestart}
          disabled={isRestarting}
          aria-label={`Restart ${service.displayName}`}
          className="flex items-center justify-center gap-1 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-gray-500"
        >
          {isRestarting ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
          )}
          {isRestarting ? 'Restarting...' : 'Restart'}
        </button>
      </div>

      {/* Details */}
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-gray-600">
          <Phone className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <span>{service.phone_number}</span>
        </div>

        <div className="flex items-start sm:items-center gap-2 text-gray-600">
          <span className="text-gray-400 flex-shrink-0">URL:</span>
          <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded break-all">
            {service.url}
          </code>
        </div>

        {service.last_message_at && (
          <div className="flex items-center gap-2 text-gray-600">
            <Clock className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <span>Last message: {new Date(service.last_message_at).toLocaleString()}</span>
          </div>
        )}

        {service.error_message && (
          <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-xs" role="alert">
            {service.error_message}
          </div>
        )}

        {service.needs_auth && (
          <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-yellow-700 text-xs" role="alert">
            ⚠️ Authentication required. Please re-authenticate the device.
          </div>
        )}
      </div>
    </div>
  );
};

export default ServicesTab;
