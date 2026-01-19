/**
 * Location Section - DR Lookup and location fields
 * 🟢 WORKING: Form section with DR lookup integration
 */

'use client';

import { MapPin, Search, CheckCircle, AlertTriangle, X, Loader2 } from 'lucide-react';
import type { TicketFormData, TicketFormErrors } from '../../../hooks/useTicketForm';
import type { DRLookupData } from '../../../types/ticket';

interface LocationSectionProps {
  formData: TicketFormData;
  errors: TicketFormErrors;
  setField: <K extends keyof TicketFormData>(field: K, value: TicketFormData[K]) => void;
  drLookup: {
    isLoading: boolean;
    isFound: boolean;
    isNotFound: boolean;
    error: string | null;
    data: DRLookupData | null;
  };
  onLookupDR: (drNumber: string) => Promise<void>;
  onClearDRLookup: () => void;
  disabled?: boolean;
}

export function LocationSection({
  formData,
  errors,
  setField,
  drLookup,
  onLookupDR,
  onClearDRLookup,
  disabled,
}: LocationSectionProps) {
  const handleLookup = async () => {
    if (formData.dr_number.trim()) {
      await onLookupDR(formData.dr_number.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleLookup();
    }
  };

  const isReadonly = drLookup.isFound;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-lg font-semibold text-[var(--ff-text-primary)]">
        <MapPin className="w-5 h-5 text-blue-400" />
        Location
      </div>

      {/* DR Lookup */}
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          DR Number
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={formData.dr_number}
              onChange={(e) => setField('dr_number', e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter DR number to lookup..."
              disabled={disabled || isReadonly}
              className={`w-full px-3 py-2 pr-10 rounded-lg border bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                drLookup.isFound
                  ? 'border-green-500'
                  : drLookup.isNotFound
                    ? 'border-yellow-500'
                    : 'border-[var(--ff-border-light)]'
              } disabled:opacity-50`}
            />
            {drLookup.isLoading && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400 animate-spin" />
            )}
            {drLookup.isFound && !drLookup.isLoading && (
              <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400" />
            )}
            {drLookup.isNotFound && !drLookup.isLoading && (
              <AlertTriangle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-yellow-400" />
            )}
          </div>
          {isReadonly ? (
            <button
              type="button"
              onClick={onClearDRLookup}
              disabled={disabled}
              className="px-3 py-2 rounded-lg bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleLookup}
              disabled={disabled || drLookup.isLoading || !formData.dr_number.trim()}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {drLookup.isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              Lookup
            </button>
          )}
        </div>
        {drLookup.isFound && drLookup.data && (
          <p className="mt-1 text-sm text-green-400">
            Found: {drLookup.data.project_name || 'Project data loaded'}
          </p>
        )}
        {drLookup.isNotFound && (
          <p className="mt-1 text-sm text-yellow-400">
            DR not found in SOW - you can enter location details manually
          </p>
        )}
        {drLookup.error && (
          <p className="mt-1 text-sm text-red-400">{drLookup.error}</p>
        )}
      </div>

      {/* Location Fields Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Project */}
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
            Project
          </label>
          <input
            type="text"
            value={drLookup.data?.project_name || formData.project_id || ''}
            onChange={(e) => setField('project_id', e.target.value)}
            placeholder="Project name or ID"
            disabled={disabled || isReadonly}
            readOnly={isReadonly}
            className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 read-only:bg-[var(--ff-bg-tertiary)]"
          />
        </div>

        {/* Zone */}
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
            Zone
          </label>
          <input
            type="text"
            value={formData.zone_id}
            onChange={(e) => setField('zone_id', e.target.value)}
            placeholder="Zone number"
            disabled={disabled || isReadonly}
            readOnly={isReadonly}
            className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 read-only:bg-[var(--ff-bg-tertiary)]"
          />
        </div>

        {/* Pole Number */}
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
            Pole Number
          </label>
          <input
            type="text"
            value={formData.pole_number}
            onChange={(e) => setField('pole_number', e.target.value)}
            placeholder="Pole number"
            disabled={disabled || isReadonly}
            readOnly={isReadonly}
            className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 read-only:bg-[var(--ff-bg-tertiary)]"
          />
        </div>

        {/* PON Number */}
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
            PON Number
          </label>
          <input
            type="text"
            value={formData.pon_number}
            onChange={(e) => setField('pon_number', e.target.value)}
            placeholder="PON number"
            disabled={disabled || isReadonly}
            readOnly={isReadonly}
            className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 read-only:bg-[var(--ff-bg-tertiary)]"
          />
        </div>
      </div>

      {/* Address */}
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          Address
        </label>
        <input
          type="text"
          value={formData.address}
          onChange={(e) => setField('address', e.target.value)}
          placeholder="Physical address"
          disabled={disabled || isReadonly}
          readOnly={isReadonly}
          className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 read-only:bg-[var(--ff-bg-tertiary)]"
        />
      </div>

      {/* GPS Coordinates */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
            Latitude
          </label>
          <input
            type="text"
            value={formData.latitude}
            onChange={(e) => setField('latitude', e.target.value)}
            placeholder="-26.0000"
            disabled={disabled || isReadonly}
            readOnly={isReadonly}
            className={`w-full px-3 py-2 rounded-lg border bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              errors.latitude ? 'border-red-500' : 'border-[var(--ff-border-light)]'
            } disabled:opacity-50 read-only:bg-[var(--ff-bg-tertiary)]`}
          />
          {errors.latitude && (
            <p className="mt-1 text-sm text-red-400">{errors.latitude}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
            Longitude
          </label>
          <input
            type="text"
            value={formData.longitude}
            onChange={(e) => setField('longitude', e.target.value)}
            placeholder="28.0000"
            disabled={disabled || isReadonly}
            readOnly={isReadonly}
            className={`w-full px-3 py-2 rounded-lg border bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              errors.longitude ? 'border-red-500' : 'border-[var(--ff-border-light)]'
            } disabled:opacity-50 read-only:bg-[var(--ff-bg-tertiary)]`}
          />
          {errors.longitude && (
            <p className="mt-1 text-sm text-red-400">{errors.longitude}</p>
          )}
        </div>
      </div>
    </div>
  );
}
