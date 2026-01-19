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
import { AlertCircle, Loader2, Save, X, RotateCcw } from 'lucide-react';
import { useTicketForm } from '../../hooks/useTicketForm';
import {
  SourceSection,
  DetailsSection,
  LocationSection,
  EquipmentSection,
  ClientSection,
  AssignmentSection,
  FaultSection,
} from './sections';

interface TicketFormProps {
  onCancel?: () => void;
}

export function TicketForm({ onCancel }: TicketFormProps) {
  const router = useRouter();
  const form = useTicketForm();

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    } else {
      router.push('/ticketing/tickets');
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

      {/* Section 1: Source & Classification */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
        <SourceSection
          formData={form.formData}
          errors={form.errors}
          setField={form.setField}
          disabled={form.isSubmitting}
        />
      </div>

      {/* Section 2: Ticket Details */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
        <DetailsSection
          formData={form.formData}
          errors={form.errors}
          setField={form.setField}
          disabled={form.isSubmitting}
        />
      </div>

      {/* Section 3: Location (DR Lookup) */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
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

      {/* Section 4: Equipment Information */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
        <EquipmentSection
          formData={form.formData}
          errors={form.errors}
          setField={form.setField}
          disabled={form.isSubmitting}
        />
      </div>

      {/* Section 5: Client Information */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
        <ClientSection
          formData={form.formData}
          errors={form.errors}
          setField={form.setField}
          disabled={form.isSubmitting}
        />
      </div>

      {/* Section 6: Assignment */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
        <AssignmentSection
          formData={form.formData}
          errors={form.errors}
          setField={form.setField}
          disabled={form.isSubmitting}
        />
      </div>

      {/* Section 7: Fault Attribution (Maintenance Only) */}
      <FaultSection
        formData={form.formData}
        errors={form.errors}
        setField={form.setField}
        disabled={form.isSubmitting}
      />

      {/* Form Actions */}
      <div className="flex items-center justify-between pt-4 border-t border-[var(--ff-border-light)]">
        <button
          type="button"
          onClick={form.reset}
          disabled={form.isSubmitting || !form.isDirty}
          className="inline-flex items-center gap-2 px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RotateCcw className="w-4 h-4" />
          Clear Form
        </button>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCancel}
            disabled={form.isSubmitting}
            className="px-4 py-2 rounded-lg border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={form.isSubmitting}
            className="inline-flex items-center gap-2 px-6 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {form.isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
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
