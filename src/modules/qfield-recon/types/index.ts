export type LastStatus =
  | 'applied' | 'conflict' | 'not_applied' | 'error' | 'started' | 'pending';

export type AuditKind = 'optical' | 'civil';
export type FeatureClass =
  | 'applied' | 'stale_duplicate' | 'stuck_recoverable' | 'never_captured';

/** One audit delta, projected from core_delta (never the full JSONB). */
export interface AuditDelta {
  id: string;
  featureKey: string;      // content->>'localPk'
  label: string | null;    // old/new attributes 'label'
  kind: AuditKind;         // derived from Status
  status: string;          // new.attributes.Status, e.g. 'Optical Complete'
  lastStatus: LastStatus;
  ponNo: number | null;    // splitter pon_no (optical); null for poles
  zone: string | null;
  createdAt: string;       // ISO 8601
  photoKeys: string[];     // keys of files_sha256 (e.g. 'DCIM/x.jpg')
}

/** Design topology resolved from the project GeoPackage. */
export interface PonMap {
  available: boolean;            // false when the project has no design layer
  gpkgVersion: string | null;    // version key the cache is stored under
  resolvedAt: string | null;
  designPons: number[];          // all PON numbers in design (MOAPons.dp)
  poleToPon: Record<string, { pon: number; zone: string | null }>; // pole label -> PON
}

export interface PhotoFlag {
  deltaId: string;
  featureKey: string;
  label: string | null;
  photoKey: string;              // DCIM key referenced by the delta but absent in MinIO
}

export interface StuckDelta {
  deltaId: string;
  featureKey: string;
  label: string | null;
  kind: AuditKind;
  status: string;
  lastStatus: LastStatus;
  ponNo: number | null;
  createdAt: string;
  supersededByAppliedTwin: boolean;  // true => stale duplicate (recovered); false => genuinely stuck
}

export interface PonSummary {
  ponNo: number | null;          // null = poles with no resolvable PON (no design layer)
  kind: AuditKind;
  designFeatures: number;        // expected count from design (0 if unknown)
  applied: number;               // features net-complete (includes staleDuplicate)
  stuckRecoverable: number;
  staleDuplicate: number;        // subset of applied that also had a stuck twin
  neverCaptured: number;
  missingPhotos: number;
}

export interface ReconModel {
  project: { id: string; name: string };
  designLayer: { available: boolean; gpkgVersion: string | null; resolvedAt: string | null };
  totals: {
    applied: number; stuckRecoverable: number;
    staleDuplicate: number; neverCaptured: number;
  };
  optical: PonSummary[];
  civil: PonSummary[];
  stuckDeltas: StuckDelta[];
  photoFlags: PhotoFlag[];
  notes: string[];
}

export interface BuildInput {
  project: { id: string; name: string };
  deltas: AuditDelta[];
  ponMap: PonMap;
  presentPhotoKeys: Set<string>;  // logical DCIM keys present in MinIO
  notes?: string[];
}
