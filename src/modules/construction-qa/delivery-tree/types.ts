/**
 * QA Centre delivery tree — shared types.
 *
 * Read-only projection over `pon_stage_tracking`, `pon_delivery_state` and
 * `zone_delivery_documents`. No write path exists for this view.
 */

/** A zone is in Maintenance once both handover certificates are active. */
export type ZoneDeliveryStatus = 'Maintenance' | 'WIP';

/** A PON is Optical Submitted once its port submission has been recorded. */
export type PonDeliveryStatus = 'Optical Submitted' | 'WIP';

/** Build counts carried by every tree row; zone rows are sums over their PONs. */
export interface DeliveryCounts {
  poles_total: number;
  poles_planted: number;
  activation_total: number;
  activation_complete: number;
}

/** Active (non-superseded) zone certificate presence, per project + zone. */
export interface ZoneDocumentFlags {
  hasActiveFac: boolean;
  hasActiveCac: boolean;
}

/** One flat row as returned by the delivery-tree SQL: a single PON. */
export interface DeliveryTreeQueryRow extends DeliveryCounts, ZoneDocumentFlags {
  project_id: string;
  project_name: string;
  zone_no: number;
  pon_no: number;
  /** ISO-8601 timestamp, or null when the PON has not been submitted. */
  port_submitted_at: string | null;
}

export interface DeliveryTreePon {
  pon_no: number;
  status: PonDeliveryStatus;
  counts: DeliveryCounts;
  opticalSubmittedAt: string | null;
}

export interface DeliveryTreeZone {
  zone_no: number;
  status: ZoneDeliveryStatus;
  counts: DeliveryCounts;
  pons: DeliveryTreePon[];
}

export interface DeliveryTreeProject {
  id: string;
  name: string;
  zones: DeliveryTreeZone[];
}

export interface DeliveryTreeResult {
  projects: DeliveryTreeProject[];
}
