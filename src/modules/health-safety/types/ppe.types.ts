/**
 * H&S PPE catalogue + issuance types
 */

export type PPECategory =
  | 'head' | 'eye' | 'hand' | 'foot' | 'body' | 'hearing' | 'respiratory' | 'fall' | 'other';

export const PPE_CATEGORIES: { value: PPECategory; label: string }[] = [
  { value: 'head', label: 'Head' },
  { value: 'eye', label: 'Eye/Face' },
  { value: 'hand', label: 'Hand' },
  { value: 'foot', label: 'Foot' },
  { value: 'body', label: 'Body' },
  { value: 'hearing', label: 'Hearing' },
  { value: 'respiratory', label: 'Respiratory' },
  { value: 'fall', label: 'Fall protection' },
  { value: 'other', label: 'Other' },
];

/** Whether an issued item is current, due soon, or overdue for replacement. */
export type PPEReplacementStatus = 'ok' | 'due_soon' | 'overdue' | 'no_schedule';

/** Days before replacement_due at which an item is flagged "due soon". */
export const PPE_DUE_SOON_DAYS = 30;

export interface PPECatalogueItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: PPECategory;
  lifespan_months: number | null;
  sizes: string[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PPEIssuance {
  id: string;
  ppe_item_id: string;
  staff_id: string | null;
  team_member_id: string | null;
  contractor_id: string | null;
  worker_name: string;
  project_id: string | null;
  size: string | null;
  quantity: number;
  issued_date: string;
  replacement_due: string | null;
  signature_name: string | null;
  signed_at: string | null;
  signed_by: string | null;
  signed_ip: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
