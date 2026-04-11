/**
 * TicketForm Component
 * Complete form for creating new tickets with all sections
 *
 * 🟢 WORKING: Production-ready ticket creation form
 *
 * Features:
 * - 7 organized sections: Source, Details, Location, Equipment, Client, Assignment, Fault
 * - DR number lookup with auto-population
 * - Client-side validation
 * - Submit with loading state
 * - Error handling and display
 */

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { AlertCircle, Save, X, RotateCcw } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { useTicketForm, type TicketFormData } from '../../hooks/useTicketForm';
import { TicketCategory } from '../../types/ticket';
import {
  CategorySection,
  DetailsSection,
  LocationSection,
  EquipmentSection,
  ClientSection,
  AssignmentSection,
  FaultSection,
  DevOpsSection,
} from './sections';

interface TicketFormProps {
  onCancel?: () => void;
  /** Optional initial values to pre-populate the form (e.g., from URL params) */
  initialValues?: Partial<TicketFormData>;
}

/** Section visibility configuration per category */
interface SectionVisibility {
  location: boolean;
  equipment: boolean;
  client: boolean;
  fault: boolean;
  devops: boolean;
}

/**
 * Section visibility keyed by the new T1 category. Fault attribution is
 * required for Maintenance tickets (per April-11 decision). DevOps owns
 * its own screenshot-first flow. Sales Lead is contact-focused, HSE is
 * location-focused, Snag is location + no client.
 */
const SECTIONS_BY_CATEGORY: Record<TicketCategory, SectionVisibility> = {
  [TicketCategory.MAINTENANCE]:  { location: true,  equipment: true,  client: true,  fault: true,  devops: false },
  [TicketCategory.SNAG]:         { location: true,  equipment: false, client: false, fault: false, devops: false },
  [TicketCategory.HSE_INCIDENT]: { location: true,  equipment: false, client: false, fault: false, devops: false },
  [TicketCategory.DEV_OPS]:      { location: false, equipment: false, client: false, fault: false, devops: true  },
  [TicketCategory.SALES_LEAD]:   { location: false, equipment: false, client: true,  fault: false, devops: false },
  [TicketCategory.UNSPECIFIED]:  { location: true,  equipment: false, client: true,  fault: false, devops: false },
};

/** Shown before the user picks a category — collapsed layout. */
const EMPTY_SECTIONS: SectionVisibility = {
  location: false, equipment: false, client: false, fault: false, devops: false,
};

export function TicketForm({ onCancel, initialValues }: TicketFormProps) {
  const router = useRouter();
  const form = useTicketForm();
  const initializedRef = useRef(false);

  // Determine which sections to show based on the selected category.
  // Before a category is picked (initial state), only CategorySection + the
  // minimal Details section render, so the form doesn't overwhelm the user
  // with empty fields for sections they might not need.
  const category = form.formData.category as TicketCategory | '';
  const sections = category ? SECTIONS_BY_CATEGORY[category] : EMPTY_SECTIONS;

  // Pre-populate form with initial values on mount
  useEffect(() => {
    if (initialValues && Object.keys(initialValues).length > 0 && !initializedRef.current) {
      initializedRef.current = true;
      form.setFields(initialValues);

      // If DR number is provided, trigger lookup to populate location fields
      if (initialValues.dr_number) {
        form.lookupDR(initialValues.dr_number);
      }
    }
  }, [initialValues, form]);

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    } else {
      router.push('/noc/tickets');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await form.submit();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Submit Error Banner */}
      {form.submitError && (
        <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-medium text-red-400">Failed to create ticket</h4>
            <p className="text-sm text-red-400/80 mt-1">{form.submitError}</p>
          </div>
          <button
            type="button"
            onClick={() => form.reset()}
            className="text-red-400 hover:text-red-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Section 1: Category & Discipline */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 sm:p-6 border border-[var(--ff-border-light)]">
        <CategorySection
          formData={form.formData}
          errors={form.errors}
          setField={form.setField}
          setFields={form.setFields}
          disabled={form.isSubmitting}
        />
      </div>

      {/* Section 2a: DevOps Details — shown BEFORE details for dev_ops tickets (screenshot-first) */}
      {sections.devops && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 sm:p-6 border border-[var(--ff-border-light)]">
          <DevOpsSection
            formData={form.formData}
            errors={form.errors}
            setField={form.setField}
            setFields={form.setFields}
            onFileAdded={form.addMediaFile}
            onFileRemoved={form.removeMediaFile}
            disabled={form.isSubmitting}
          />
        </div>
      )}

      {/* Section 2b: Ticket Details — hidden until category is picked */}
      {category && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 sm:p-6 border border-[var(--ff-border-light)]">
          <DetailsSection
            formData={form.formData}
            errors={form.errors}
            setField={form.setField}
            disabled={form.isSubmitting}
          />
        </div>
      )}

      {/* Section 3: Location (DR Lookup) — hidden for DevOps tickets */}
      {sections.location && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 sm:p-6 border border-[var(--ff-border-light)]">
          <LocationSection
            formData={form.formData}
            errors={form.errors}
            setField={form.setField}
            drLookup={form.drLookup}
            onLookupDR={form.lookupDR}
            onClearDRLookup={form.clearDRLookup}
            disabled={form.isSubmitting}
          />
        </div>
      )}

      {/* Section 4: Equipment Information — hidden for DevOps/HSE/Incident tickets */}
      {sections.equipment && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 sm:p-6 border border-[var(--ff-border-light)]">
          <EquipmentSection
            formData={form.formData}
            errors={form.errors}
            setField={form.setField}
            disabled={form.isSubmitting}
          />
        </div>
      )}

      {/* Section 5: Client Information — hidden for DevOps/HSE/investigation tickets */}
      {sections.client && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 sm:p-6 border border-[var(--ff-border-light)]">
          <ClientSection
            formData={form.formData}
            errors={form.errors}
            setField={form.setField}
            disabled={form.isSubmitting}
          />
        </div>
      )}

      {/* Section 6: Assignment — hidden until category is picked */}
      {category && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 sm:p-6 border border-[var(--ff-border-light)]">
          <AssignmentSection
            formData={form.formData}
            errors={form.errors}
            setField={form.setField}
            setFields={form.setFields}
            disabled={form.isSubmitting}
          />
        </div>
      )}

      {/* Section 7: Fault Attribution — only for fault_repair tickets */}
      {sections.fault && (
        <FaultSection
          formData={form.formData}
          errors={form.errors}
          setField={form.setField}
          disabled={form.isSubmitting}
        />
      )}

      {/* Form Actions — sticky on mobile for easy access */}
      <div className="flex items-center justify-between pt-4 border-t border-[var(--ff-border-light)] sticky bottom-0 bg-[var(--ff-bg-primary)] pb-4 sm:static sm:pb-0 z-10">
        <button
          type="button"
          onClick={form.reset}
          disabled={form.isSubmitting || !form.isDirty}
          className="inline-flex items-center gap-2 px-3 py-3 sm:px-4 sm:py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RotateCcw className="w-4 h-4" />
          <span className="hidden sm:inline">Clear Form</span>
          <span className="sm:hidden">Clear</span>
        </button>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={handleCancel}
            disabled={form.isSubmitting}
            className="px-4 py-3 sm:py-2 rounded-lg border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={form.isSubmitting}
            className="inline-flex items-center gap-2 px-5 py-3 sm:px-6 sm:py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {form.isSubmitting ? (
              <>
                <InlineSpinner size="sm" />
                Creating...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Create Ticket
              </>
            )}
          </button>
        </div>
      </div>

      {/* Unsaved Changes Warning */}
      {form.isDirty && !form.isSubmitting && (
        <p className="text-center text-sm text-[var(--ff-text-muted)]">
          You have unsaved changes
        </p>
      )}
    </form>
  );
}
