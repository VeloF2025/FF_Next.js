/**
 * The details step of a certificate submission.
 *
 * Presentational and controlled — the parent form owns every value, the
 * validation and both actions. Split out so the form itself stays a state
 * machine rather than a state machine wrapped around two screens of markup.
 */

import { TrainingTypeMultiSelect } from './TrainingTypeMultiSelect';
import {
  TrainingCertificateFields,
  type TrainingCertificateFieldValues,
} from './TrainingCertificateFields';
import type { HSTrainingType } from '../../types/training.types';

export interface StaffOption {
  id: string;
  name: string;
}

const labelCls = 'block text-sm font-medium text-[var(--ff-text-secondary)] mb-1';
const inputCls =
  'w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';

export interface TrainingCertificateDetailsProps {
  showEmployeePicker: boolean;
  staffOptions: StaffOption[];
  selectedStaffId: string;
  onStaffChange(id: string): void;
  types: HSTrainingType[];
  selectedTypeIds: string[];
  onTypesChange(ids: string[]): void;
  values: TrainingCertificateFieldValues;
  fileName: string | null;
  onFileChange(file: File | null): void;
  onValueChange<K extends keyof TrainingCertificateFieldValues>(
    key: K,
    value: TrainingCertificateFieldValues[K]
  ): void;
  onCancel(): void;
  onReview(): void;
}

export function TrainingCertificateDetails({
  showEmployeePicker,
  staffOptions,
  selectedStaffId,
  onStaffChange,
  types,
  selectedTypeIds,
  onTypesChange,
  values,
  fileName,
  onFileChange,
  onValueChange,
  onCancel,
  onReview,
}: TrainingCertificateDetailsProps) {
  return (
        <div className="space-y-4">
          {showEmployeePicker && (
            <div>
              <label htmlFor="certificate-staff" className={labelCls}>
                Employee *
              </label>
              <select
                id="certificate-staff"
                className={inputCls}
                value={selectedStaffId}
                onChange={(e) => onStaffChange(e.target.value)}
              >
                <option value="">Select employee…</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <TrainingCertificateFields
            values={values}
            fileName={fileName}
            onFileChange={onFileChange}
            onValueChange={onValueChange}
          />

          <TrainingTypeMultiSelect
            types={types}
            selectedIds={selectedTypeIds}
            onChange={onTypesChange}
          />

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onReview}
              className="px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] text-white rounded-lg transition-colors"
            >
              Review
            </button>
          </div>
        </div>
  );
}
