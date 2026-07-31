/**
 * File and metadata fields for a certificate submission.
 *
 * Purely controlled — every value and the validation live in the parent form, so
 * the same fields serve the modal on the employee profile and the full page in
 * the H&S module without either owning workflow state.
 */


/** Mirrors the server's accepted set; the server re-checks the magic bytes. */
export const ACCEPTED_CERTIFICATE_EXTENSIONS = '.pdf,.jpg,.jpeg,.png,.doc,.docx';

const inputCls =
  'w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';
const labelCls = 'block text-sm font-medium text-[var(--ff-text-secondary)] mb-1';

export interface TrainingCertificateFieldValues {
  certificateNumber: string;
  provider: string;
  completedDate: string;
  expiryDate: string;
}

export interface TrainingCertificateFieldsProps {
  values: TrainingCertificateFieldValues;
  fileName: string | null;
  disabled?: boolean;
  onFileChange(file: File | null): void;
  onValueChange<K extends keyof TrainingCertificateFieldValues>(
    key: K,
    value: TrainingCertificateFieldValues[K]
  ): void;
}

export function TrainingCertificateFields({
  values,
  fileName,
  disabled,
  onFileChange,
  onValueChange,
}: TrainingCertificateFieldsProps) {
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="certificate-file" className={labelCls}>
          Certificate file *
        </label>
        <input
          id="certificate-file"
          type="file"
          disabled={disabled}
          accept={ACCEPTED_CERTIFICATE_EXTENSIONS}
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          className={inputCls}
        />
        <p className="mt-1 text-xs text-[var(--ff-text-secondary)]">
          PDF, JPG, PNG, DOC or DOCX, up to 10 MB.
          {fileName ? ` Selected: ${fileName}` : ''}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="certificate-number" className={labelCls}>
            Certificate number *
          </label>
          <input
            id="certificate-number"
            type="text"
            disabled={disabled}
            value={values.certificateNumber}
            onChange={(e) => onValueChange('certificateNumber', e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="certificate-provider" className={labelCls}>
            Provider *
          </label>
          <input
            id="certificate-provider"
            type="text"
            disabled={disabled}
            value={values.provider}
            onChange={(e) => onValueChange('provider', e.target.value)}
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="certificate-completed" className={labelCls}>
            Completion date *
          </label>
          <input
            id="certificate-completed"
            type="date"
            disabled={disabled}
            value={values.completedDate}
            onChange={(e) => onValueChange('completedDate', e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="certificate-expiry" className={labelCls}>
            Expiry date
          </label>
          <input
            id="certificate-expiry"
            type="date"
            disabled={disabled}
            value={values.expiryDate}
            onChange={(e) => onValueChange('expiryDate', e.target.value)}
            className={inputCls}
          />
          {/* Each competency derives its own expiry from its catalogue cadence
              when this is left blank, so it is genuinely optional. */}
          <p className="mt-1 text-xs text-[var(--ff-text-secondary)]">
            Leave blank to use each competency&apos;s standard validity period.
          </p>
        </div>
      </div>
    </div>
  );
}
