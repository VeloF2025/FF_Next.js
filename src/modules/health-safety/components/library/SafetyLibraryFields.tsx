/**
 * Field set for the Safety Library form.
 *
 * Split out of SafetyLibraryForm purely to keep both components inside the
 * 200-line limit; it owns no state — the parent holds the form values and the
 * submit logic.
 *
 * The chemical block renders only for content_type = 'msds', matching the DB
 * constraint hs_safety_library_chemical_fields_msds_only.
 */

import {
  SAFETY_LIBRARY_TYPES,
  type SafetyLibraryContentType,
} from '@/modules/health-safety/types/library.types';
import { HSAttachmentUpload } from '../attachments/HSAttachmentUpload';

export interface SafetyLibraryFormValues {
  content_type: SafetyLibraryContentType;
  title: string;
  reference: string;
  version: string;
  project_id: string;
  file_url: string;
  file_name: string;
  effective_date: string;
  review_date: string;
  supplier: string;
  ghs_hazard_class: string;
  storage_location: string;
  notes: string;
}

interface Props {
  form: SafetyLibraryFormValues;
  projects: { id: string; name: string }[];
  isChemical: boolean;
  set: (field: string, value: string) => void;
  setContentType: (value: SafetyLibraryContentType) => void;
  /** Absent while creating — an attachment needs a saved entry to hang off. */
  entryId?: string;
}

const inputClass =
  'w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';
const labelClass = 'block text-xs font-medium text-[var(--ff-text-secondary)] mb-1';

export function SafetyLibraryFields({
  form,
  projects,
  isChemical,
  set,
  setContentType,
  entryId,
}: Props) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Type *</label>
          <select value={form.content_type} onChange={(e) => setContentType(e.target.value as SafetyLibraryContentType)} className={inputClass}>
            {Object.values(SAFETY_LIBRARY_TYPES).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Project</label>
          <select value={form.project_id} onChange={(e) => set('project_id', e.target.value)} className={inputClass}>
            <option value="">— Company-wide —</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass}>Title *</label>
        <input type="text" value={form.title} onChange={(e) => set('title', e.target.value)} className={inputClass} placeholder={isChemical ? 'e.g. Isopropyl Alcohol (IPA)' : 'e.g. Working at Heights'} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={labelClass}>Reference</label>
          <input type="text" value={form.reference} onChange={(e) => set('reference', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Version</label>
          <input type="text" value={form.version} onChange={(e) => set('version', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>File name</label>
          <input type="text" value={form.file_name} onChange={(e) => set('file_name', e.target.value)} className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass}>Document URL</label>
        <input type="url" value={form.file_url} onChange={(e) => set('file_url', e.target.value)} className={inputClass} placeholder="https://…" />
        <p className="mt-1 text-xs text-[var(--ff-text-tertiary)]">
          For a document published elsewhere — a supplier SDS or a public standard. Upload the
          file instead when it is ours to hold.
        </p>
      </div>

      {entryId ? (
        <HSAttachmentUpload surface="library" parentId={entryId} label="Uploaded documents" />
      ) : (
        <p className="text-xs text-[var(--ff-text-tertiary)]">
          Save the entry to upload a document to it.
        </p>
      )}

      {isChemical && (
        <div className="grid grid-cols-3 gap-4 p-3 rounded-lg border border-[var(--ff-border-light)]">
          <div>
            <label className={labelClass}>Supplier</label>
            <input type="text" value={form.supplier} onChange={(e) => set('supplier', e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>GHS hazard class</label>
            <input type="text" value={form.ghs_hazard_class} onChange={(e) => set('ghs_hazard_class', e.target.value)} className={inputClass} placeholder="from the SDS" />
          </div>
          <div>
            <label className={labelClass}>Storage location</label>
            <input type="text" value={form.storage_location} onChange={(e) => set('storage_location', e.target.value)} className={inputClass} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Effective date</label>
          <input type="date" value={form.effective_date} onChange={(e) => set('effective_date', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Next review date</label>
          <input type="date" value={form.review_date} onChange={(e) => set('review_date', e.target.value)} className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass}>Notes</label>
        <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} className={inputClass} />
      </div>
    </>
  );
}
