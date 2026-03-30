'use client';

import { MancoActionItem } from '@/types/manco-action-items.types';
import { formatDate } from './manco-grid-helpers';

interface MancoItemDetailsProps {
  item: MancoActionItem;
}

interface DetailFieldProps {
  label: string;
  value: string;
}

/** Single label + value pair in the metadata grid. */
function DetailField({ label, value }: DetailFieldProps) {
  return (
    <div>
      <p className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase">{label}</p>
      <p className="text-sm text-[var(--ff-text-primary)] mt-1">{value}</p>
    </div>
  );
}

/**
 * Read-only metadata grid for a manco action item (department, responsible,
 * dates, FibreFlow tracking fields).
 */
export function MancoItemDetails({ item }: MancoItemDetailsProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {item.department && (
        <DetailField label="Department" value={item.department} />
      )}
      {item.responsible_person && (
        <DetailField label="Responsible" value={item.responsible_person} />
      )}
      {item.logged_date && (
        <DetailField label="Logged" value={formatDate(item.logged_date)} />
      )}
      {item.completion_eta && (
        <DetailField label="ETA" value={formatDate(item.completion_eta)} />
      )}
      {item.completion_date && (
        <DetailField label="Completed" value={formatDate(item.completion_date)} />
      )}
      {item.fibreflow_module && (
        <DetailField label="FF Module" value={item.fibreflow_module} />
      )}
      {item.fibreflow_responsible && (
        <DetailField label="FF Owner" value={item.fibreflow_responsible} />
      )}
      {item.fibreflow_dev_status && (
        <DetailField label="FF Status" value={item.fibreflow_dev_status} />
      )}
    </div>
  );
}
