/**
 * useTicketForm Hook - Form State Management for Ticket Creation
 *
 * 🟢 WORKING: Production-ready hook for ticket creation form
 *
 * Features:
 * - Complete form state management for all ticket fields
 * - DR lookup integration with auto-population
 * - Client-side validation
 * - Submit handler with API integration
 * - Field-level error tracking
 * - Dirty state tracking for unsaved changes warning
 */

'use client';

import { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useDRLookup } from './useDRLookup';
import { useCreateTicket } from './useTickets';
import {
  TicketSource,
  TicketType,
  TicketPriority,
  FaultCause,
  type CreateTicketPayload,
  type DRLookupData,
} from '../types/ticket';

// ==================== Types ====================

export interface TicketFormData {
  // Section 1: Source & Classification
  source: TicketSource;
  ticket_type: TicketType;
  priority: TicketPriority;

  // Section 2: Ticket Details
  title: string;
  description: string;
  external_id: string;

  // Section 3: Location (DR Lookup)
  dr_number: string;
  project_id: string;
  zone_id: string;
  pole_number: string;
  pon_number: string;
  address: string;
  latitude: string;
  longitude: string;

  // Section 4: Equipment
  ont_serial: string;
  ont_rx_level: string;
  ont_model: string;

  // Section 5: Client Information
  client_name: string;
  client_contact: string;
  client_email: string;

  // Section 6: Assignment
  assigned_to: string;
  assigned_contractor_id: string;
  assigned_team: string;

  // Section 7: Fault Attribution (maintenance only)
  fault_cause: FaultCause | '';
  fault_cause_details: string;
}

export interface TicketFormErrors {
  [key: string]: string | undefined;
}

export interface UseTicketFormResult {
  // Form state
  formData: TicketFormData;
  errors: TicketFormErrors;
  isDirty: boolean;
  isSubmitting: boolean;
  submitError: string | null;

  // DR Lookup state
  drLookup: {
    isLoading: boolean;
    isFound: boolean;
    isNotFound: boolean;
    error: string | null;
    data: DRLookupData | null;
  };

  // Form actions
  setField: <K extends keyof TicketFormData>(field: K, value: TicketFormData[K]) => void;
  setFields: (fields: Partial<TicketFormData>) => void;
  lookupDR: (drNumber: string) => Promise<void>;
  clearDRLookup: () => void;
  validate: () => boolean;
  submit: () => Promise<void>;
  reset: () => void;
}

// ==================== Initial State ====================

const initialFormData: TicketFormData = {
  source: TicketSource.MANUAL,
  ticket_type: TicketType.MAINTENANCE,
  priority: TicketPriority.NORMAL,
  title: '',
  description: '',
  external_id: '',
  dr_number: '',
  project_id: '',
  zone_id: '',
  pole_number: '',
  pon_number: '',
  address: '',
  latitude: '',
  longitude: '',
  ont_serial: '',
  ont_rx_level: '',
  ont_model: '',
  client_name: '',
  client_contact: '',
  client_email: '',
  assigned_to: '',
  assigned_contractor_id: '',
  assigned_team: '',
  fault_cause: '',
  fault_cause_details: '',
};

// ==================== Validation ====================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[+]?[\d\s-()]{7,20}$/;

function validateFormData(data: TicketFormData): TicketFormErrors {
  const errors: TicketFormErrors = {};

  // Required fields
  if (!data.title.trim()) {
    errors.title = 'Title is required';
  } else if (data.title.length > 255) {
    errors.title = 'Title must be less than 255 characters';
  }

  if (!data.source) {
    errors.source = 'Source is required';
  }

  if (!data.ticket_type) {
    errors.ticket_type = 'Ticket type is required';
  }

  // Optional field validation
  if (data.client_email && !EMAIL_REGEX.test(data.client_email)) {
    errors.client_email = 'Invalid email format';
  }

  if (data.client_contact && !PHONE_REGEX.test(data.client_contact)) {
    errors.client_contact = 'Invalid phone format';
  }

  if (data.ont_rx_level) {
    const rxLevel = parseFloat(data.ont_rx_level);
    if (isNaN(rxLevel)) {
      errors.ont_rx_level = 'Must be a valid number';
    } else if (rxLevel < -40 || rxLevel > 0) {
      errors.ont_rx_level = 'Must be between -40 and 0 dBm';
    }
  }

  if (data.latitude) {
    const lat = parseFloat(data.latitude);
    if (isNaN(lat) || lat < -90 || lat > 90) {
      errors.latitude = 'Invalid latitude (-90 to 90)';
    }
  }

  if (data.longitude) {
    const lng = parseFloat(data.longitude);
    if (isNaN(lng) || lng < -180 || lng > 180) {
      errors.longitude = 'Invalid longitude (-180 to 180)';
    }
  }

  // Fault cause required for maintenance tickets
  if (data.ticket_type === TicketType.MAINTENANCE && !data.fault_cause) {
    errors.fault_cause = 'Fault cause is required for maintenance tickets';
  }

  return errors;
}

// ==================== Hook ====================

/**
 * 🟢 WORKING: Comprehensive form management hook for ticket creation
 *
 * @example
 * ```tsx
 * const form = useTicketForm();
 *
 * // Set field values
 * form.setField('title', 'Fiber issue at location');
 * form.setField('source', TicketSource.MANUAL);
 *
 * // DR Lookup
 * await form.lookupDR('DR001234');
 *
 * // Submit
 * if (form.validate()) {
 *   await form.submit();
 * }
 * ```
 */
export function useTicketForm(): UseTicketFormResult {
  const router = useRouter();
  const drLookupHook = useDRLookup();
  const createTicketMutation = useCreateTicket();

  const [formData, setFormData] = useState<TicketFormData>(initialFormData);
  const [errors, setErrors] = useState<TicketFormErrors>({});
  const [isDirty, setIsDirty] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ==================== Field Setters ====================

  const setField = useCallback(<K extends keyof TicketFormData>(
    field: K,
    value: TicketFormData[K]
  ) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setIsDirty(true);
    // Clear error when field is changed
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  }, [errors]);

  const setFields = useCallback((fields: Partial<TicketFormData>) => {
    setFormData(prev => ({ ...prev, ...fields }));
    setIsDirty(true);
    // Clear errors for changed fields
    const fieldsToCheck = Object.keys(fields) as (keyof TicketFormData)[];
    setErrors(prev => {
      const newErrors = { ...prev };
      fieldsToCheck.forEach(field => {
        delete newErrors[field];
      });
      return newErrors;
    });
  }, []);

  // ==================== DR Lookup ====================

  const lookupDR = useCallback(async (drNumber: string) => {
    const result = await drLookupHook.lookup(drNumber);

    if (result) {
      // Auto-populate fields from DR lookup
      setFields({
        dr_number: result.dr_number,
        project_id: result.project_id || '',
        zone_id: result.zone_number?.toString() || '',
        pole_number: result.pole_number || '',
        pon_number: result.pon_number?.toString() || '',
        address: result.address || '',
        latitude: result.latitude?.toString() || '',
        longitude: result.longitude?.toString() || '',
      });
    }
  }, [drLookupHook, setFields]);

  const clearDRLookup = useCallback(() => {
    drLookupHook.clear();
    setFields({
      dr_number: '',
      project_id: '',
      zone_id: '',
      pole_number: '',
      pon_number: '',
      address: '',
      latitude: '',
      longitude: '',
    });
  }, [drLookupHook, setFields]);

  // ==================== Validation ====================

  const validate = useCallback((): boolean => {
    const validationErrors = validateFormData(formData);
    setErrors(validationErrors);
    return Object.keys(validationErrors).length === 0;
  }, [formData]);

  // ==================== Submit ====================

  const submit = useCallback(async () => {
    setSubmitError(null);

    if (!validate()) {
      return;
    }

    // Build payload
    const payload: CreateTicketPayload = {
      source: formData.source,
      title: formData.title.trim(),
      ticket_type: formData.ticket_type,
      priority: formData.priority,
    };

    // Add optional fields if provided
    if (formData.description.trim()) {
      payload.description = formData.description.trim();
    }
    if (formData.external_id.trim()) {
      payload.external_id = formData.external_id.trim();
    }
    if (formData.dr_number.trim()) {
      payload.dr_number = formData.dr_number.trim();
    }
    if (formData.project_id) {
      payload.project_id = formData.project_id;
    }
    if (formData.zone_id) {
      payload.zone_id = formData.zone_id;
    }
    if (formData.pole_number.trim()) {
      payload.pole_number = formData.pole_number.trim();
    }
    if (formData.pon_number.trim()) {
      payload.pon_number = formData.pon_number.trim();
    }
    if (formData.address.trim()) {
      payload.address = formData.address.trim();
    }
    if (formData.assigned_to) {
      payload.assigned_to = formData.assigned_to;
    }
    if (formData.assigned_contractor_id) {
      payload.assigned_contractor_id = formData.assigned_contractor_id;
    }
    if (formData.assigned_team.trim()) {
      payload.assigned_team = formData.assigned_team.trim();
    }

    try {
      const ticket = await createTicketMutation.mutateAsync(payload);
      // Redirect to ticket detail on success
      router.push(`/ticketing/tickets/${ticket.id}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create ticket';
      setSubmitError(errorMessage);
    }
  }, [formData, validate, createTicketMutation, router]);

  // ==================== Reset ====================

  const reset = useCallback(() => {
    setFormData(initialFormData);
    setErrors({});
    setIsDirty(false);
    setSubmitError(null);
    drLookupHook.clear();
  }, [drLookupHook]);

  // ==================== Return ====================

  return {
    formData,
    errors,
    isDirty,
    isSubmitting: createTicketMutation.isPending,
    submitError,
    drLookup: {
      isLoading: drLookupHook.isLoading,
      isFound: drLookupHook.isFound,
      isNotFound: drLookupHook.isNotFound,
      error: drLookupHook.error,
      data: drLookupHook.data,
    },
    setField,
    setFields,
    lookupDR,
    clearDRLookup,
    validate,
    submit,
    reset,
  };
}

// ==================== Enum Labels ====================

export const TICKET_SOURCE_LABELS: Record<TicketSource, string> = {
  [TicketSource.MANUAL]: 'Manual',
  [TicketSource.QCONTACT]: 'QContact',
  [TicketSource.WEEKLY_REPORT]: 'Weekly Report',
  [TicketSource.CONSTRUCTION]: 'Construction',
  [TicketSource.INCIDENT]: 'Incident',
  [TicketSource.REVENUE]: 'Revenue',
  [TicketSource.ONT_SWAP]: 'ONT Swap',
  [TicketSource.AD_HOC]: 'Ad-Hoc',
};

export const TICKET_TYPE_LABELS: Record<TicketType, string> = {
  [TicketType.MAINTENANCE]: 'Maintenance',
  [TicketType.NEW_INSTALLATION]: 'New Installation',
  [TicketType.MODIFICATION]: 'Modification',
  [TicketType.ONT_SWAP]: 'ONT Swap',
  [TicketType.INCIDENT]: 'Incident',
};

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  [TicketPriority.LOW]: 'Low',
  [TicketPriority.NORMAL]: 'Normal',
  [TicketPriority.HIGH]: 'High',
  [TicketPriority.URGENT]: 'Urgent',
  [TicketPriority.CRITICAL]: 'Critical',
};

export const FAULT_CAUSE_LABELS: Record<FaultCause, string> = {
  [FaultCause.WORKMANSHIP]: 'Workmanship',
  [FaultCause.MATERIAL_FAILURE]: 'Material Failure',
  [FaultCause.CLIENT_DAMAGE]: 'Client Damage',
  [FaultCause.THIRD_PARTY]: 'Third Party',
  [FaultCause.ENVIRONMENTAL]: 'Environmental',
  [FaultCause.VANDALISM]: 'Vandalism',
  [FaultCause.UNKNOWN]: 'Unknown',
};

export const PRIORITY_COLORS: Record<TicketPriority, string> = {
  [TicketPriority.LOW]: 'bg-gray-500/20 text-gray-400',
  [TicketPriority.NORMAL]: 'bg-blue-500/20 text-blue-400',
  [TicketPriority.HIGH]: 'bg-yellow-500/20 text-yellow-400',
  [TicketPriority.URGENT]: 'bg-orange-500/20 text-orange-400',
  [TicketPriority.CRITICAL]: 'bg-red-500/20 text-red-400',
};
