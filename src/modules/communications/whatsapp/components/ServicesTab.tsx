/**
 * Services Tab - WhatsApp Service Status, Controls, and Pairing
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
  Key,
  LogOut,
  Copy,
  CheckCheck,
} from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';
import { waAdminApi } from '../services/waAdminApiService';
import type { WaServicesStatusResponse, WaServiceStatus, ServiceStatus, WaPhoneNumber } from '../types/wa-admin.types';

/* Services Tab - Displays WhatsApp Bridge and Sender service status with restart and pairing controls */

// Pairing Modal Component
interface PairingModalProps {
  isOpen: boolean;
  onClose: () => void;
  service: 'bridge' | 'sender';
  serviceName: string;
  currentPhone: string;
}

const PairingModal: React.FC<PairingModalProps> = ({
  isOpen,
  onClose,
  service,
  serviceName,
  currentPhone,
}) => {
  const [phoneNumber, setPhoneNumber] = useState(currentPhone);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'generating' | 'waiting' | 'connected' | 'failed' | 'expired'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setPairingCode(null);
      setStatus('idle');
      setError(null);
      setPhoneNumber(currentPhone);
    }
  }, [isOpen, currentPhone]);

  // Poll for pairing status when waiting
  useEffect(() => {
    if (status !== 'waiting') return;

    const pollInterval = setInterval(async () => {
      const result = await waAdminApi.services.pairingStatus(service);
      if (result.success && result.data) {
        if (result.data.status === 'connected') {
          setStatus('connected');
          notificationService.success(`${serviceName} paired successfully!`);
          setTimeout(onClose, 2000);
        } else if (result.data.status === 'failed') {
          setStatus('failed');
          setError(result.data.error_message || 'Pairing failed');
        } else if (result.data.status === 'expired') {
          setStatus('expired');
          setError('Pairing code expired. Please try again.');
        }
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [status, service, serviceName, onClose]);

  const handleInitiatePairing = async () => {
    setStatus('generating');
    setError(null);

    const result = await waAdminApi.services.pair(service, phoneNumber);

    if (result.success && result.data) {
      setPairingCode(result.data.pairing_code || null);
      setInstructions(result.data.instructions || []);
      setExpiresAt(result.data.expires_at || null);
      setStatus('waiting');
    } else {
      setStatus('failed');
      setError(result.error || 'Failed to initiate pairing');
    }
  };

  const handleCopyCode = () => {
    if (pairingCode) {
      navigator.clipboard.writeText(pairingCode);
      setCopied(true);
      notificationService.success('Code copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-card rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Key className="w-5 h-5 text-green-500" />
          Pair {serviceName}
        </h3>

        {status === 'idle' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Enter the phone number to link with this service. This will generate a pairing code.
            </p>

            <div>
              <label className="block text-sm font-medium mb-1">Phone Number</label>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+27821234567"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:outline-none"
              />
              <p className="text-xs text-muted-foreground mt-1">Include country code (e.g., +27 for South Africa)</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 border rounded-lg hover:bg-background transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleInitiatePairing}
                disabled={!phoneNumber}
                className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50"
              >
                Generate Code
              </button>
            </div>
          </div>
        )}

        {status === 'generating' && (
          <div className="text-center py-8">
            <Loader2 className="w-12 h-12 animate-spin text-green-500 mx-auto mb-4" />
            <p className="text-muted-foreground">Generating pairing code...</p>
          </div>
        )}

        {status === 'waiting' && pairingCode && (
          <div className="space-y-4">
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 text-center">
              <p className="text-sm text-green-700 dark:text-green-400 mb-2">Enter this code in WhatsApp:</p>
              <div className="flex items-center justify-center gap-2">
                <span className="text-3xl font-mono font-bold text-green-600 dark:text-green-400 tracking-widest">
                  {pairingCode}
                </span>
                <button
                  onClick={handleCopyCode}
                  className="p-2 hover:bg-green-100 dark:hover:bg-green-800 rounded transition-colors"
                  title="Copy code"
                >
                  {copied ? (
                    <CheckCheck className="w-5 h-5 text-green-600" />
                  ) : (
                    <Copy className="w-5 h-5 text-green-600" />
                  )}
                </button>
              </div>
              {expiresAt && (
                <p className="text-xs text-green-600 dark:text-green-500 mt-2">
                  Expires: {new Date(expiresAt).toLocaleTimeString()}
                </p>
              )}
            </div>

            <div className="bg-secondary rounded-lg p-3">
              <p className="text-sm font-medium mb-2">Instructions:</p>
              <ol className="text-sm text-muted-foreground space-y-1">
                {instructions.map((instruction, idx) => (
                  <li key={idx}>{instruction}</li>
                ))}
              </ol>
            </div>

            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Waiting for phone to connect...
            </div>

            <button
              onClick={onClose}
              className="w-full px-4 py-2 border rounded-lg hover:bg-background transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {status === 'connected' && (
          <div className="text-center py-8">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <p className="text-lg font-medium text-green-600">Paired Successfully!</p>
            <p className="text-sm text-muted-foreground mt-2">The service is now connected.</p>
          </div>
        )}

        {(status === 'failed' || status === 'expired') && (
          <div className="space-y-4">
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-center">
              <XCircle className="w-12 h-12 text-red-500 mx-auto mb-2" />
              <p className="text-red-700 dark:text-red-400">{error || 'Pairing failed'}</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 border rounded-lg hover:bg-background transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => setStatus('idle')}
                className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const ServicesTab: React.FC = () => {
  const [status, setStatus] = useState<WaServicesStatusResponse | null>(null);
  const [phoneNumbers, setPhoneNumbers] = useState<WaPhoneNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restartingService, setRestartingService] = useState<string | null>(null);
  const [pairingModal, setPairingModal] = useState<{
    isOpen: boolean;
    service: 'bridge';
    serviceName: string;
    currentPhone: string;
  } | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [statusResult, phonesResult] = await Promise.all([
      waAdminApi.services.status(),
      waAdminApi.phones.list(),
    ]);

    if (statusResult.success && statusResult.data) {
      setStatus(statusResult.data);
    } else {
      setError(statusResult.error || 'Failed to fetch service status');
    }

    if (phonesResult.success && phonesResult.data) {
      setPhoneNumbers(phonesResult.data);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStatus();

    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleRestart = async (service: 'bridge') => {
    if (restartingService) return;

    setRestartingService(service);

    const result = await waAdminApi.services.restart(service);

    if (result.success) {
      notificationService.success(`${service} service restart initiated`);
      setTimeout(() => {
        fetchStatus();
        setRestartingService(null);
      }, 3000);
    } else {
      notificationService.error(result.error || 'Failed to restart service');
      setRestartingService(null);
    }
  };

  const handlePair = (service: WaServiceStatus) => {
    setPairingModal({
      isOpen: true,
      service: 'bridge',
      serviceName: service.displayName,
      currentPhone: service.phone_number,
    });
  };

  const handleLogout = async (service: 'bridge', serviceName: string) => {
    if (!confirm(`Are you sure you want to logout ${serviceName}? You will need to re-pair the device.`)) {
      return;
    }

    const result = await waAdminApi.services.logout(service);

    if (result.success) {
      notificationService.success(`${serviceName} logged out`);
      fetchStatus();
    } else {
      notificationService.error(result.error || 'Failed to logout');
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
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'disconnected':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'connecting':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'error':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getOverallStatusBadge = (overall: 'healthy' | 'degraded' | 'down') => {
    switch (overall) {
      case 'healthy':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-green-500/20 text-green-400 border border-green-500/30 text-sm font-medium">
            <CheckCircle className="w-4 h-4" /> All Systems Operational
          </span>
        );
      case 'degraded':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 text-sm font-medium">
            <AlertCircle className="w-4 h-4" /> Partial Outage
          </span>
        );
      case 'down':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 text-sm font-medium">
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
          className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] rounded transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {/* Service Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {status && (
          <ServiceCard
            service={status.bridge}
            onRestart={() => handleRestart('bridge')}
            onPair={() => handlePair(status.bridge)}
            onLogout={() => handleLogout('bridge', 'WhatsApp Bridge')}
            isRestarting={restartingService === 'bridge'}
            getStatusIcon={getStatusIcon}
            getStatusColor={getStatusColor}
          />
        )}
      </div>

      {/* Phone Numbers Section */}
      {phoneNumbers.length > 0 && (
        <div className="border border-[var(--ff-border-light)] rounded-lg p-4 bg-[var(--ff-bg-card)]">
          <h4 className="font-semibold text-[var(--ff-text-primary)] mb-3 flex items-center gap-2">
            <Phone className="w-4 h-4" />
            Registered Phone Numbers
          </h4>
          <div className="space-y-2">
            {(['bridge'] as const).map((service) => {
              const servicePhones = phoneNumbers.filter((p) => p.service === service);
              if (servicePhones.length === 0) return null;

              return (
                <div key={service} className="space-y-1">
                  <p className="text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                    Bridge
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {servicePhones.map((phone) => (
                      <div
                        key={phone.id}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${
                          phone.role === 'primary'
                            ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                            : 'bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)]'
                        }`}
                      >
                        <span className="font-medium">{phone.display_name || phone.phone_number}</span>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${
                            phone.role === 'primary'
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-tertiary)]'
                          }`}
                        >
                          {phone.role.toUpperCase()}
                        </span>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${
                            phone.status === 'paired'
                              ? 'bg-blue-500/20 text-blue-400'
                              : 'bg-yellow-500/20 text-yellow-400'
                          }`}
                        >
                          {phone.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-3">
            💡 To add a fallback number, configure it in Settings tab → Service Config
          </p>
        </div>
      )}

      {/* Last checked timestamp */}
      {status && (
        <p className="text-xs text-[var(--ff-text-secondary)] text-right">
          Last checked: {new Date(status.checked_at).toLocaleString()}
        </p>
      )}

      {/* Pairing Modal */}
      {pairingModal && (
        <PairingModal
          isOpen={pairingModal.isOpen}
          onClose={() => {
            setPairingModal(null);
            fetchStatus();
          }}
          service={pairingModal.service}
          serviceName={pairingModal.serviceName}
          currentPhone={pairingModal.currentPhone}
        />
      )}
    </div>
  );
};

interface ServiceCardProps {
  service: WaServiceStatus;
  onRestart: () => void;
  onPair: () => void;
  onLogout: () => void;
  isRestarting: boolean;
  getStatusIcon: (status: ServiceStatus) => React.ReactNode;
  getStatusColor: (status: ServiceStatus) => string;
}

const ServiceCard: React.FC<ServiceCardProps> = ({
  service,
  onRestart,
  onPair,
  onLogout,
  isRestarting,
  getStatusIcon,
  getStatusColor,
}) => {
  return (
    <div className="border border-[var(--ff-border-light)] rounded-lg p-4 sm:p-5 bg-[var(--ff-bg-card)]">
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

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {service.needs_auth && (
            <button
              onClick={onPair}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-500 hover:bg-green-600 text-white rounded transition-colors focus:outline-none focus:ring-2 focus:ring-green-500"
              title="Authenticate this service"
            >
              <Key className="w-4 h-4" />
              Pair
            </button>
          )}

          {service.session_valid && (
            <button
              onClick={onLogout}
              className="flex items-center gap-1 px-2 py-1.5 text-sm text-red-400 hover:bg-red-500/10 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
              title="Logout and clear session"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={onRestart}
            disabled={isRestarting}
            aria-label={`Restart ${service.displayName}`}
            className="flex items-center justify-center gap-1 px-3 py-1.5 text-sm bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-border-light)] text-[var(--ff-text-primary)] rounded transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            {isRestarting ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
            )}
            {isRestarting ? 'Restarting...' : 'Restart'}
          </button>
        </div>
      </div>

      {/* Details */}
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-[var(--ff-text-secondary)]">
          <Phone className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <span>{service.phone_number}</span>
          <span className="text-xs bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded">SENDS &amp; RECEIVES</span>
        </div>

        <div className="flex items-start sm:items-center gap-2 text-[var(--ff-text-secondary)]">
          <span className="text-[var(--ff-text-tertiary)] flex-shrink-0">URL:</span>
          <code className="text-xs bg-[var(--ff-bg-tertiary)] px-1.5 py-0.5 rounded break-all">
            {service.url}
          </code>
        </div>

        {service.last_message_at && (
          <div className="flex items-center gap-2 text-[var(--ff-text-secondary)]">
            <Clock className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <span>Last message: {new Date(service.last_message_at).toLocaleString()}</span>
          </div>
        )}

        {service.error_message && (
          <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-xs" role="alert">
            {service.error_message}
          </div>
        )}

        {service.needs_auth && (
          <div className="mt-3 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-yellow-400 text-xs flex items-center gap-2" role="alert">
            <Key className="w-4 h-4" />
            Authentication required. Click &quot;Pair&quot; to link a WhatsApp device.
          </div>
        )}
      </div>
    </div>
  );
};

export default ServicesTab;
