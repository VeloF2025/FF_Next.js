/**
 * Fleet Maintenance Page
 * Upcoming services, service intervals, and service history
 */

import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { notificationService } from '@/services/core/NotificationService';
import {
  Wrench,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Plus,
  Calendar,
  Gauge,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  X,
  Loader2,
} from 'lucide-react';
import type { UpcomingService, ServiceUrgency, ServiceType } from '@/modules/fleet/types/maintenance.types';

interface Vehicle {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
}

interface ServiceIntervalFormData {
  vehicleId: string;
  serviceType: ServiceType;
  intervalKm: string;
  intervalMonths: string;
  lastServiceKm: string;
  lastServiceDate: string;
  estimatedCost: string;
  providerName: string;
  notes: string;
}

const URGENCY_STYLES: Record<ServiceUrgency, { bg: string; text: string; label: string }> = {
  overdue: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', label: 'Overdue' },
  critical: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-400', label: 'Critical' },
  warning: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-400', label: 'Warning' },
  ok: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400', label: 'OK' },
};

const SERVICE_TYPE_LABELS: Record<string, string> = {
  oil_change: 'Oil Change',
  major_service: 'Major Service',
  minor_service: 'Minor Service',
  brake_pads: 'Brake Pads',
  brake_discs: 'Brake Discs',
  tyres: 'Tyres',
  transmission: 'Transmission',
  timing_belt: 'Timing Belt',
  air_filter: 'Air Filter',
  fuel_filter: 'Fuel Filter',
  spark_plugs: 'Spark Plugs',
  battery: 'Battery',
  coolant_flush: 'Coolant Flush',
  wheel_alignment: 'Wheel Alignment',
  suspension: 'Suspension',
  clutch: 'Clutch',
  other: 'Other',
};

function formatCurrency(amount: number): string {
  return `R${amount.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-ZA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatNumber(num: number | null): string {
  if (num === null) return '-';
  return num.toLocaleString('en-ZA');
}

// Loading skeleton
function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
            <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-20 mb-2"></div>
            <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-12"></div>
          </div>
        ))}
      </div>
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
        <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded w-32 mb-4"></div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-[var(--ff-bg-tertiary)] rounded"></div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Stats Card
function StatsCard({
  label,
  count,
  icon: Icon,
  urgency,
}: {
  label: string;
  count: number;
  icon: React.ElementType;
  urgency?: ServiceUrgency;
}) {
  const style = urgency ? URGENCY_STYLES[urgency] : { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-300' };

  return (
    <div className={`rounded-lg p-4 border border-[var(--ff-border-light)] ${style.bg}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className={`text-sm font-medium ${style.text}`}>{label}</p>
          <p className={`text-2xl font-bold mt-1 ${style.text}`}>{count}</p>
        </div>
        <Icon className={`w-8 h-8 ${style.text} opacity-50`} />
      </div>
    </div>
  );
}

// Service Row
function ServiceRow({ service }: { service: UpcomingService }) {
  const [expanded, setExpanded] = useState(false);
  const style = URGENCY_STYLES[service.urgency];

  return (
    <div className={`border-l-4 ${style.text.replace('text-', 'border-')} bg-[var(--ff-bg-secondary)] rounded-r-lg mb-2`}>
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-[var(--ff-bg-tertiary)] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-4">
          <div>
            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${style.bg} ${style.text}`}>
              {style.label}
            </span>
          </div>
          <div>
            <p className="font-medium text-[var(--ff-text-primary)]">
              {service.registration}
            </p>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              {service.make} {service.model}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="font-medium text-[var(--ff-text-primary)]">
              {SERVICE_TYPE_LABELS[service.serviceType] || service.serviceType}
            </p>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              {service.daysUntilDue !== null
                ? service.daysUntilDue < 0
                  ? `${Math.abs(service.daysUntilDue)} days overdue`
                  : `Due in ${service.daysUntilDue} days`
                : service.kmUntilDue !== null
                ? `${formatNumber(service.kmUntilDue)} km remaining`
                : 'Check required'}
            </p>
          </div>

          {expanded ? (
            <ChevronUp className="w-5 h-5 text-[var(--ff-text-tertiary)]" />
          ) : (
            <ChevronDown className="w-5 h-5 text-[var(--ff-text-tertiary)]" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-[var(--ff-border-light)]">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 text-sm">
            <div>
              <p className="text-[var(--ff-text-secondary)]">Interval</p>
              <p className="text-[var(--ff-text-primary)]">
                {service.intervalKm ? `${formatNumber(service.intervalKm)} km` : ''}
                {service.intervalKm && service.intervalMonths ? ' / ' : ''}
                {service.intervalMonths ? `${service.intervalMonths} months` : ''}
              </p>
            </div>
            <div>
              <p className="text-[var(--ff-text-secondary)]">Last Service</p>
              <p className="text-[var(--ff-text-primary)]">
                {formatDate(service.lastServiceDate)}
                {service.lastServiceKm && ` @ ${formatNumber(service.lastServiceKm)} km`}
              </p>
            </div>
            <div>
              <p className="text-[var(--ff-text-secondary)]">Next Due</p>
              <p className="text-[var(--ff-text-primary)]">
                {formatDate(service.nextServiceDate)}
                {service.nextServiceKm && ` or ${formatNumber(service.nextServiceKm)} km`}
              </p>
            </div>
            <div>
              <p className="text-[var(--ff-text-secondary)]">Est. Cost</p>
              <p className="text-[var(--ff-text-primary)]">
                {service.estimatedCost ? formatCurrency(service.estimatedCost) : '-'}
              </p>
            </div>
          </div>

          {service.providerName && (
            <div className="mt-3 pt-3 border-t border-[var(--ff-border-light)]">
              <p className="text-sm text-[var(--ff-text-secondary)]">
                Preferred provider: <span className="text-[var(--ff-text-primary)]">{service.providerName}</span>
              </p>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button className="px-3 py-1.5 text-sm bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] transition-colors">
              Record Service
            </button>
            <button className="px-3 py-1.5 text-sm border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors">
              Edit Interval
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const SERVICE_TYPES: ServiceType[] = [
  'oil_change',
  'major_service',
  'minor_service',
  'brake_pads',
  'brake_discs',
  'tyres',
  'transmission',
  'timing_belt',
  'air_filter',
  'fuel_filter',
  'spark_plugs',
  'battery',
  'coolant_flush',
  'wheel_alignment',
  'suspension',
  'clutch',
  'other',
];

const INITIAL_FORM_DATA: ServiceIntervalFormData = {
  vehicleId: '',
  serviceType: 'oil_change',
  intervalKm: '',
  intervalMonths: '',
  lastServiceKm: '',
  lastServiceDate: '',
  estimatedCost: '',
  providerName: '',
  notes: '',
};

export default function FleetMaintenancePage() {
  const [services, setServices] = useState<UpcomingService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | ServiceUrgency>('all');

  // Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [formData, setFormData] = useState<ServiceIntervalFormData>(INITIAL_FORM_DATA);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Fetch vehicles for dropdown
  useEffect(() => {
    async function fetchVehicles() {
      try {
        const res = await fetch('/api/fleet/vehicles');
        if (!res.ok) return;
        const data = await res.json();
        setVehicles(data.data || []);
      } catch {
        // Silent fail - will show empty dropdown
      }
    }
    fetchVehicles();
  }, []);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch('/api/fleet/analytics/upcoming-services?days=180');
        if (!res.ok) throw new Error('Failed to fetch upcoming services');

        const data = await res.json();
        setServices(data.data || []);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load data';
        setError(message);
        notificationService.error(`Failed to load maintenance data: ${message}`);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  // Form handlers
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      // Validate required fields
      if (!formData.vehicleId) {
        throw new Error('Please select a vehicle');
      }
      if (!formData.intervalKm && !formData.intervalMonths) {
        throw new Error('Please specify at least one interval (km or months)');
      }

      const payload = {
        vehicleId: formData.vehicleId,
        serviceType: formData.serviceType,
        intervalKm: formData.intervalKm ? parseInt(formData.intervalKm, 10) : undefined,
        intervalMonths: formData.intervalMonths ? parseInt(formData.intervalMonths, 10) : undefined,
        lastServiceKm: formData.lastServiceKm ? parseInt(formData.lastServiceKm, 10) : undefined,
        lastServiceDate: formData.lastServiceDate || undefined,
        estimatedCost: formData.estimatedCost ? parseFloat(formData.estimatedCost) : undefined,
        providerName: formData.providerName || undefined,
        notes: formData.notes || undefined,
      };

      const res = await fetch('/api/fleet/maintenance/intervals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to create service interval');
      }

      // Success - close modal and refresh data
      setShowAddModal(false);
      setFormData(INITIAL_FORM_DATA);
      notificationService.success('Service interval created successfully');

      // Refresh data without full page reload
      const res2 = await fetch(`/api/fleet/maintenance/intervals?limit=50`);
      if (res2.ok) {
        const data = await res2.json();
        setIntervals(data.data?.intervals || []);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setFormError(message);
      notificationService.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const openAddModal = () => {
    setFormData(INITIAL_FORM_DATA);
    setFormError(null);
    setShowAddModal(true);
  };

  // Calculate stats
  const overdueCount = services.filter(s => s.urgency === 'overdue').length;
  const criticalCount = services.filter(s => s.urgency === 'critical').length;
  const warningCount = services.filter(s => s.urgency === 'warning').length;
  const okCount = services.filter(s => s.urgency === 'ok').length;

  // Filter services
  const filteredServices = filter === 'all'
    ? services
    : services.filter(s => s.urgency === filter);

  if (loading) {
    return (
      <AppLayout>
        <div className="p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Fleet Maintenance</h1>
            <p className="text-[var(--ff-text-secondary)]">Loading...</p>
          </div>
          <LoadingSkeleton />
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Fleet Maintenance</h1>
          </div>
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-400 mb-2">
              Failed to Load Data
            </h2>
            <p className="text-red-600 dark:text-red-300 mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] flex items-center gap-2">
              <Wrench className="w-7 h-7 text-[var(--ff-primary)]" />
              Fleet Maintenance
            </h1>
            <p className="text-[var(--ff-text-secondary)]">
              Service scheduling, intervals, and history
            </p>
          </div>
          <button
            onClick={openAddModal}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Service Interval
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatsCard label="Overdue" count={overdueCount} icon={AlertTriangle} urgency="overdue" />
          <StatsCard label="Critical" count={criticalCount} icon={Clock} urgency="critical" />
          <StatsCard label="Warning" count={warningCount} icon={Calendar} urgency="warning" />
          <StatsCard label="OK" count={okCount} icon={CheckCircle2} urgency="ok" />
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 border-b border-[var(--ff-border-light)]">
          {(['all', 'overdue', 'critical', 'warning', 'ok'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                filter === f
                  ? 'border-[var(--ff-primary)] text-[var(--ff-primary)]'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
              }`}
            >
              {f === 'all' ? 'All Services' : URGENCY_STYLES[f].label}
              {f !== 'all' && (
                <span className="ml-2 px-1.5 py-0.5 text-xs rounded bg-[var(--ff-bg-tertiary)]">
                  {f === 'overdue' ? overdueCount : f === 'critical' ? criticalCount : f === 'warning' ? warningCount : okCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Services List */}
        <div>
          {filteredServices.length === 0 ? (
            <div className="text-center py-12 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">
                {filter === 'all' ? 'No Upcoming Services' : `No ${URGENCY_STYLES[filter as ServiceUrgency].label} Services`}
              </h3>
              <p className="text-[var(--ff-text-secondary)]">
                {filter === 'all'
                  ? 'All vehicles are up to date with their maintenance schedules.'
                  : 'No services match this filter.'}
              </p>
            </div>
          ) : (
            <div>
              {filteredServices.map((service) => (
                <ServiceRow key={service.intervalId} service={service} />
              ))}
            </div>
          )}
        </div>

        {/* Summary */}
        {services.length > 0 && (
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
            <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
              <div className="flex items-center gap-6">
                <div>
                  <span className="text-[var(--ff-text-secondary)]">Total Upcoming: </span>
                  <span className="font-medium text-[var(--ff-text-primary)]">{services.length}</span>
                </div>
                <div>
                  <span className="text-[var(--ff-text-secondary)]">Est. Total Cost: </span>
                  <span className="font-medium text-[var(--ff-text-primary)]">
                    {formatCurrency(services.reduce((sum, s) => sum + (s.estimatedCost || 0), 0))}
                  </span>
                </div>
              </div>
              <p className="text-[var(--ff-text-tertiary)]">
                Showing services due within 180 days or 5,000 km
              </p>
            </div>
          </div>
        )}

        {/* Add Service Interval Modal */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setShowAddModal(false)}
            />

            {/* Modal */}
            <div className="relative bg-[var(--ff-bg-primary)] rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-light)]">
                <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                  Add Service Interval
                </h2>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="p-1 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-[var(--ff-text-secondary)]" />
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="p-4 space-y-4">
                {formError && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
                  </div>
                )}

                {/* Vehicle Selection */}
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Vehicle *
                  </label>
                  <select
                    name="vehicleId"
                    value={formData.vehicleId}
                    onChange={handleInputChange}
                    required
                    className="w-full px-3 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 hover:border-gray-500"
                  >
                    <option value="">Select a vehicle...</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.registration} - {v.make} {v.model}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Service Type */}
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Service Type *
                  </label>
                  <select
                    name="serviceType"
                    value={formData.serviceType}
                    onChange={handleInputChange}
                    required
                    className="w-full px-3 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 hover:border-gray-500"
                  >
                    {SERVICE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {SERVICE_TYPE_LABELS[type] || type}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Intervals */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                      Interval (km)
                    </label>
                    <div className="relative">
                      <Gauge className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
                      <input
                        type="number"
                        name="intervalKm"
                        value={formData.intervalKm}
                        onChange={handleInputChange}
                        placeholder="e.g. 15000"
                        className="w-full pl-10 pr-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                      Interval (months)
                    </label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
                      <input
                        type="number"
                        name="intervalMonths"
                        value={formData.intervalMonths}
                        onChange={handleInputChange}
                        placeholder="e.g. 12"
                        className="w-full pl-10 pr-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
                      />
                    </div>
                  </div>
                </div>

                <p className="text-xs text-[var(--ff-text-tertiary)]">
                  Specify at least one interval (km-based, time-based, or both)
                </p>

                {/* Last Service */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                      Last Service km
                    </label>
                    <input
                      type="number"
                      name="lastServiceKm"
                      value={formData.lastServiceKm}
                      onChange={handleInputChange}
                      placeholder="Current odometer"
                      className="w-full px-3 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 hover:border-gray-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                      Last Service Date
                    </label>
                    <input
                      type="date"
                      name="lastServiceDate"
                      value={formData.lastServiceDate}
                      onChange={handleInputChange}
                      className="w-full px-3 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 hover:border-gray-500"
                    />
                  </div>
                </div>

                {/* Cost & Provider */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                      Estimated Cost (R)
                    </label>
                    <input
                      type="number"
                      name="estimatedCost"
                      value={formData.estimatedCost}
                      onChange={handleInputChange}
                      placeholder="e.g. 3500"
                      className="w-full px-3 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 hover:border-gray-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                      Preferred Provider
                    </label>
                    <input
                      type="text"
                      name="providerName"
                      value={formData.providerName}
                      onChange={handleInputChange}
                      placeholder="e.g. Toyota Service"
                      className="w-full px-3 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 hover:border-gray-500"
                    />
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Notes
                  </label>
                  <textarea
                    name="notes"
                    value={formData.notes}
                    onChange={handleInputChange}
                    rows={2}
                    placeholder="Any additional notes..."
                    className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)] resize-none"
                  />
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-4 border-t border-[var(--ff-border-light)]">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] transition-colors disabled:opacity-50"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4" />
                        Add Interval
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
