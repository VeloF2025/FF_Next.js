/**
 * EXFO Exchange API Types
 *
 * Types for the reverse-engineered EXFO Exchange REST API.
 * API uses Firebase JWT auth and microservice architecture:
 * - search.exfoapis.com — Search/list results
 * - measurement.exfoapis.com — Full test details
 * - comment.exfoapis.com — Comments
 * - attachment.exfoapis.com — File downloads
 * - admin.exfoapis.com — Org config
 */

// =============================================================================
// Auth
// =============================================================================

export interface ExfoAuthTokens {
  idToken: string;
  refreshToken: string;
  expiresIn: string;
  expiresAt: number; // Unix ms timestamp
}

// =============================================================================
// Search API
// =============================================================================

export interface ExfoSearchRequest {
  from: number;
  size: number;
  search: {
    term: string;
    filters: {
      values: {
        searchParameter?: { values: string[] };
        serverUpdatedDate?: {
          values?: Array<{ start: string; end: string }>;
          datePreset?: string[];
        };
        hasRadioButton?: { values: string };
        type?: { values: string[] };
        globalVerdict?: { values: string[] };
      };
    };
  };
  sort: {
    by: string;
    order: 'asc' | 'desc';
  };
}

export interface ExfoSearchResult {
  accountId: string;
  configName: string;
  createdBy: string;
  name: string;
  globalVerdict: string | null;
  jobId: string;
  briefJobId: string;
  resultId: string;
  serverUpdatedDate: string;
  testDateTime: string;
  testPointName: string;
  testUnitACalibration: string;
  testUnitAModelName: string;
  type: string;
  updatedBy: string;
  properties: Record<string, unknown>;
  attachmentsCount: number;
  jobName: string;
}

export interface ExfoSearchResponse {
  results: ExfoSearchResult[];
  from: number;
  size: number;
}

// =============================================================================
// Measurement Detail API
// =============================================================================

export interface ExfoMeasurementDetail {
  brief: {
    Hardware?: {
      UnitA?: ExfoHardwareUnit;
      UnitB?: ExfoHardwareUnit;
    };
    Identification?: {
      CompanyName?: string;
      CustomerName?: string;
      OperatorA?: string;
      OperatorB?: string;
      JobId?: string;
      Geolocation?: ExfoGeolocation;
    };
    GlobalVerdict?: string;
    FiberInformation?: {
      FiberType?: string;
      LocationDirection?: string;
    };
    Identifiers?: ExfoIdentifier[];
    [key: string]: unknown;
  };
  metadata?: {
    platformSerialNumber?: string;
    platformUsed?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ExfoHardwareUnit {
  SerialNumber?: string;
  ModelName?: string;
  LastCalibrationDate?: string;
}

export interface ExfoGeolocation {
  latitude?: number;
  longitude?: number;
  [key: string]: unknown;
}

export interface ExfoIdentifier {
  Name?: string;
  Value?: string;
}

// =============================================================================
// Parsed Name Components
// =============================================================================

export interface ExfoParsedName {
  project: string | null;     // MOA, GRA
  section: string | null;     // STS
  sectionNum: number | null;  // 1, 2
  pole: string | null;        // B756
  cabinet: string | null;     // C5
  port: string | null;        // P5
  link: string | null;        // L14
  fiber: string | null;       // L1
}

// =============================================================================
// Sync Types
// =============================================================================

export interface ExfoSyncConfig {
  id: string;
  workspace_id: string;
  workspace_name: string;
  org_id: string;
  is_active: boolean;
  sync_interval_minutes: number;
  last_sync_at: string | null;
  last_sync_cursor: string | null;
  project_id: string | null;
}

export interface ExfoSyncResult {
  status: 'completed' | 'failed';
  resultsFetched: number;
  resultsInserted: number;
  resultsUpdated: number;
  detailsFetched: number;
  assetsMatched: number;
  error?: string;
}

// =============================================================================
// DB Row Type
// =============================================================================

export interface ExfoTestResultRow {
  id: string;
  exfo_result_id: string;
  exfo_workspace_id: string;
  test_type: string;
  test_name: string;
  job_name: string | null;
  global_verdict: string | null;
  test_date_time: string | null;
  server_updated_date: string | null;
  parsed_project: string | null;
  parsed_pole: string | null;
  parsed_cabinet: string | null;
  parsed_port: string | null;
  parsed_link: string | null;
  parsed_fiber: string | null;
  unit_a_serial: string | null;
  unit_a_model: string | null;
  unit_b_serial: string | null;
  unit_b_model: string | null;
  platform_serial: string | null;
  platform_model: string | null;
  company_name: string | null;
  customer_name: string | null;
  operator_a: string | null;
  cable_id: string | null;
  fiber_id: string | null;
  location_a: string | null;
  location_b: string | null;
  project_id: string | null;
  asset_id: string | null;
  attachments_count: number;
  synced_at: string;
  created_at: string;
  project_name?: string;
  asset_name?: string;
}
