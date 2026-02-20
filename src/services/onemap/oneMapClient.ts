/**
 * 1Map GIS API Client
 *
 * Session-based authentication with 1Map API for accessing
 * Fibertime installation data (DR records, poles, photos).
 *
 * Based on: docs/1map_integration/onemap_client.py
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('oneMapClient');

// Types
export interface OneMapRecord {
  prop_id: string;
  drp: string;           // DR number (e.g., "DR1734472")
  pole: string;          // Pole number (e.g., "LAW.P.A453")
  site: string;          // Site code (e.g., "LAW", "MOH", "MAM")
  status: string;        // Installation status
  address: string;       // Location address
  latitude: string | number | null;
  longitude: string | number | null;
  created: string;
  modified: string;
  // Photo fields
  ph_prop?: string;
  ph_after?: string;
  // Raw data
  [key: string]: unknown;
}

/**
 * Stage-relevant fields extracted from 1Map records.
 * Field names discovered from live API responses (Feb 2026, 1500-record deep scan).
 *
 * Key finding: 1Map uses `last_modified_*_date` fields for stage dates,
 * NOT dedicated date columns. Stage completion is primarily determined
 * from the `status` field string value.
 *
 * Pipeline in 1Map: Brand Awareness → Pole Permission → Home Sign Ups → Home Installation
 * Note: CWC and ATP stages are NOT tracked in 1Map — they come from QField/internal data.
 */
export interface OneMapStageFields {
  // Overall status (the primary stage indicator)
  status: string | null;
  // Permission stage — derived from status + last_modified_poles_date
  last_modified_poles_date: string | null;
  last_modified_poles_by: string | null;
  // Pole data
  poleconc: string | null;   // Pole concatenation code
  // Optical / Sign-ups — derived from status + last_modified_signup_date
  last_modified_signup_date: string | null;
  last_modified_signup_by: string | null;
  // Installation — derived from status + last_modified_install_date
  last_modified_install_date: string | null;
  last_modified_install_by: string | null;
  install: string | null;    // "Good" when installed
  // Awareness stage
  last_modified_awareness_date: string | null;
  // Date when status last changed
  date_status_changed: string | null;
  surv_date: string | null;  // Survey date
  // PON/Section info from 1Map record
  pons: string | null;       // PON number
  sect: string | null;       // Section number
  // Construction fields
  cons_pp: string | null;    // Construction pole permission
  cons_hi: string | null;    // Construction home installation
}

/** Build stage identifier */
export type OneMapBuildStage = 'permissions' | 'poles' | 'cwc' | 'optical' | 'atp' | 'activation';

/** Result of parsing a 1Map record for stage data */
export interface ParsedStageRecord {
  dr_number: string;
  prop_id: string;
  pole: string;
  site: string;
  status: string;
  zone_no: number | null;
  pon_no: number | null;
  stages: {
    permissions_complete: boolean;
    permissions_date: string | null;
    poles_complete: boolean;
    poles_date: string | null;
    cwc_complete: boolean;
    cwc_date: string | null;
    optical_complete: boolean;
    optical_date: string | null;
    atp_complete: boolean;
    atp_date: string | null;
    activation_complete: boolean;
    activation_date: string | null;
  };
}

/**
 * 1Map status patterns mapped to build stages.
 * These patterns match against the record's `status` field.
 *
 * Discovered from live API (Feb 2026, 1500 MAM records):
 *   "Brand Awareness"                                     (24.2%)
 *   "Pole Permission: Approved"                           (50.9%)
 *   "Pole Permission: Declined"                           (1.1%)
 *   "Home Sign Ups: Approved & Installation Scheduled"    (5.9%)
 *   "Home Sign Ups: Declined"                             (0.9%)
 *   "Home Sign Ups: Approved; No Drop Allocated"          (0.6%)
 *   "Home Sign Ups: Approved & Installation Re-scheduled" (0.1%)
 *   "Home Installation: Installed"                        (15.2%)
 *   "Home Installation: In Progress"                      (0.9%)
 *
 * Stage implication: each status implies all prior stages are complete.
 * e.g., "Home Installation: Installed" implies permissions + poles + optical are done.
 */
const STATUS_STAGE_PATTERNS: Array<{
  pattern: RegExp;
  stage: OneMapBuildStage;
  complete: boolean;
  /** Stages implied as complete when this status matches */
  implies?: OneMapBuildStage[];
}> = [
  // Brand Awareness — earliest stage, nothing complete yet
  { pattern: /^brand awareness$/i, stage: 'permissions', complete: false },

  // Permission stage
  { pattern: /pole permission.*approved/i,  stage: 'permissions', complete: true },
  { pattern: /pole permission.*declined/i,  stage: 'permissions', complete: false },

  // Home Sign Ups — implies permissions + poles are done
  { pattern: /home sign.*up.*approved.*scheduled/i,     stage: 'optical', complete: true,  implies: ['permissions', 'poles'] },
  { pattern: /home sign.*up.*approved.*re-scheduled/i,  stage: 'optical', complete: true,  implies: ['permissions', 'poles'] },
  { pattern: /home sign.*up.*approved.*no drop/i,       stage: 'optical', complete: true,  implies: ['permissions', 'poles'] },
  { pattern: /home sign.*up.*declined/i,                stage: 'optical', complete: false, implies: ['permissions', 'poles'] },

  // Home Installation — implies permissions + poles + optical are done
  { pattern: /home installation.*installed/i,    stage: 'activation', complete: true,  implies: ['permissions', 'poles', 'optical'] },
  { pattern: /home installation.*in progress/i,  stage: 'activation', complete: false, implies: ['permissions', 'poles', 'optical'] },
];

export interface OneMapSearchResult {
  success: boolean;
  result: OneMapRecord[];
  total_pages: number;
  current_page: number;
}

export interface OneMapClientConfig {
  email: string;
  password: string;
  baseUrl?: string;
}

// Site code to project mapping (UUID = projects.id, code = projects.project_code)
export const SITE_PROJECT_MAP: Record<string, { name: string; code: string; uuid: string }> = {
  'LAW': { name: 'Lawley', code: 'PRJ-1761224913968', uuid: '4eb13426-b2a1-472d-9b3c-277082ae9b55' },
  'MOH': { name: 'Mohadin', code: 'PRJ-1761242661257', uuid: 'bf9a90db-e758-4c05-b999-694cd63c451f' },
  'MAM': { name: 'Mamelodi', code: 'PRJ-1763722776949', uuid: '7003dc06-9af7-4a7c-bc6c-a177d77784f2' },
  'VELO': { name: 'Velo Test', code: 'VELO', uuid: '' },
};

export class OneMapClient {
  private baseUrl: string;
  private email: string;
  private password: string;
  private sessionCookie: string | null = null;
  private csrfToken: string | null = null;
  private requestCount = 0;

  constructor(config: OneMapClientConfig) {
    this.email = config.email;
    this.password = config.password;
    this.baseUrl = config.baseUrl || 'https://www.1map.co.za';
  }

  /**
   * Authenticate with 1Map using session-based login (CSRF + cookie flow)
   */
  async authenticate(): Promise<boolean> {
    logger.info('Authenticating with 1Map', { email: this.email });

    try {
      // Step 1: GET login page to extract CSRF token and initial session cookie
      const loginPage = await fetch(`${this.baseUrl}/login`, {
        signal: AbortSignal.timeout(30_000),
      });
      const html = await loginPage.text();

      const csrfMatch = html.match(/name="_csrf".*?value="([^"]+)"/);
      const csrfValue = csrfMatch ? csrfMatch[1] : '';

      // Extract initial cookies from login page
      const pageCookies = loginPage.headers.get('set-cookie') || '';
      const initialSidMatch = pageCookies.match(/connect\.sid=([^;]+)/);
      const initialCsrfMatch = pageCookies.match(/csrfToken=([^;]+)/);

      const initialCookies: string[] = [];
      if (initialSidMatch) initialCookies.push(`connect.sid=${initialSidMatch[1]}`);
      if (initialCsrfMatch) initialCookies.push(`csrfToken=${initialCsrfMatch[1]}`);

      // Step 2: POST login with CSRF token and cookies
      const response = await fetch(`${this.baseUrl}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': initialCookies.join('; '),
        },
        body: new URLSearchParams({
          _csrf: csrfValue || '',
          email: this.email,
          password: this.password,
        }).toString(),
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });

      // Extract cookies from login response
      const setCookieHeader = response.headers.get('set-cookie') || '';

      const sidMatch = setCookieHeader.match(/connect\.sid=([^;]+)/);
      if (sidMatch) {
        this.sessionCookie = sidMatch[1] ?? null;
      }

      const tokenMatch = setCookieHeader.match(/csrfToken=([^;]+)/);
      if (tokenMatch) {
        this.csrfToken = tokenMatch[1] ?? null;
      }

      if (this.sessionCookie) {
        // Step 3: Initialize layer access
        await fetch(`${this.baseUrl}/app?layer=5121`, {
          headers: { 'Cookie': this.getCookies() },
          signal: AbortSignal.timeout(30_000),
        });
        logger.info('1Map authentication successful');
        return true;
      }

      logger.error('1Map authentication failed - no session cookie', {
        status: response.status,
      });
      return false;
    } catch (error) {
      logger.error('1Map authentication error', { error });
      throw error;
    }
  }

  /**
   * Get cookies string for requests
   */
  private getCookies(): string {
    const cookies: string[] = [];
    if (this.sessionCookie) {
      cookies.push(`connect.sid=${this.sessionCookie}`);
    }
    if (this.csrfToken) {
      cookies.push(`csrfToken=${this.csrfToken}`);
    }
    return cookies.join('; ');
  }

  /**
   * Execute a search request (internal, no retry)
   */
  private async executeSearch(
    query: string,
    layerId: string,
    page: number,
    limit: number,
  ): Promise<{ response: Response; isSessionExpired: boolean }> {
    const start = (page - 1) * limit;

    const formData = new URLSearchParams({
      ungeocoded: 'false',
      left: '0',
      bottom: '0',
      right: '0',
      top: '0',
      selfilter: '',
      action: 'get',
      email: this.email,
      layerid: layerId,
      sort: 'prop_id',
      templateExpression: '',
      q: query,
      page: String(page),
      start: String(start),
      limit: String(limit),
    });

    const response = await fetch(`${this.baseUrl}/api/apps/app/getattributes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie': this.getCookies(),
      },
      body: formData.toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });

    // Detect session expiry: redirect (302), unauthorized, or HTML response
    const isSessionExpired =
      response.status === 302 ||
      response.status === 301 ||
      response.status === 401 ||
      response.status === 403 ||
      (response.headers.get('content-type')?.includes('text/html') ?? false);

    return { response, isSessionExpired };
  }

  /**
   * Search for drops (auto-retries once on session expiry)
   */
  async searchInstallations(
    query: string,
    options: {
      layerId?: string;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<OneMapSearchResult> {
    const { layerId = '5121', page = 1, limit = 50 } = options;

    if (!this.sessionCookie) {
      await this.authenticate();
    }

    // Proactively re-authenticate every 100 requests to avoid session expiry
    // (1Map sessions expire after ~125-250 requests)
    this.requestCount++;
    if (this.requestCount % 100 === 0) {
      logger.info('Proactive re-authentication', { requestCount: this.requestCount });
      await this.authenticate();
    }

    try {
      const { response, isSessionExpired } = await this.executeSearch(query, layerId, page, limit);

      // Session expired — re-authenticate and retry once
      if (isSessionExpired) {
        logger.warn('1Map session expired, re-authenticating', {
          status: response.status,
          requestCount: this.requestCount,
        });
        await this.authenticate();
        const retry = await this.executeSearch(query, layerId, page, limit);
        if (retry.isSessionExpired) {
          throw new Error(`1Map session expired after re-auth (status: ${retry.response.status})`);
        }
        if (!retry.response.ok) {
          throw new Error(`1Map API error after re-auth: ${retry.response.status}`);
        }
        return await retry.response.json() as OneMapSearchResult;
      }

      if (!response.ok) {
        throw new Error(`1Map API error: ${response.status} ${response.statusText}`);
      }

      const text = await response.text();
      // Guard against non-JSON responses (e.g. HTML error pages)
      try {
        const result = JSON.parse(text) as OneMapSearchResult;
        logger.debug('1Map search completed', {
          query, page, results: result.result?.length || 0,
        });
        return result;
      } catch {
        // Got non-JSON — session likely expired, re-auth and retry
        logger.warn('1Map returned non-JSON, re-authenticating', {
          bodyPreview: text.substring(0, 100),
        });
        await this.authenticate();
        const retry = await this.executeSearch(query, layerId, page, limit);
        if (!retry.response.ok) {
          throw new Error(`1Map API error after re-auth: ${retry.response.status}`);
        }
        return await retry.response.json() as OneMapSearchResult;
      }
    } catch (error) {
      logger.error('1Map search failed', { error, query });
      throw error;
    }
  }

  /**
   * Get a specific DR record
   */
  async getDR(drNumber: string): Promise<OneMapRecord | null> {
    const result = await this.searchInstallations(drNumber, { limit: 10 });

    if (result.success && result.result) {
      // Find exact match
      const record = result.result.find(r => r.drp === drNumber);
      if (record) {
        return record;
      }
    }

    return null;
  }

  /**
   * Get all drops for a site (handles pagination)
   */
  async getAllInstallations(
    site: string,
    options: {
      maxPages?: number;
      onProgress?: (page: number, totalPages: number, recordsFetched: number) => void;
    } = {}
  ): Promise<OneMapRecord[]> {
    const { maxPages, onProgress } = options;
    const allRecords: OneMapRecord[] = [];
    let page = 1;

    logger.info('Fetching all drops from 1Map', { site });

    while (true) {
      const result = await this.searchInstallations(site, { page, limit: 500 });

      if (!result.success || !result.result) {
        break;
      }

      allRecords.push(...result.result);

      if (onProgress) {
        onProgress(page, result.total_pages, allRecords.length);
      }

      // Check if we should continue
      if (page >= result.total_pages) {
        break;
      }

      if (maxPages && page >= maxPages) {
        logger.info('Reached max pages limit', { maxPages });
        break;
      }

      page++;

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.info('Completed fetching drops', {
      site,
      totalRecords: allRecords.length,
      pagesProcessed: page,
    });

    return allRecords;
  }

  /**
   * Get all drops for multiple sites
   */
  async getAllSiteInstallations(
    sites: string[],
    options: {
      maxPagesPerSite?: number;
      onSiteProgress?: (site: string, progress: number) => void;
    } = {}
  ): Promise<Map<string, OneMapRecord[]>> {
    const results = new Map<string, OneMapRecord[]>();

    for (const site of sites) {
      logger.info(`Fetching drops for site: ${site}`);

      const records = await this.getAllInstallations(site, {
        maxPages: options.maxPagesPerSite,
        onProgress: (page, totalPages, count) => {
          if (options.onSiteProgress) {
            const progress = Math.round((page / totalPages) * 100);
            options.onSiteProgress(site, progress);
          }
        },
      });

      results.set(site, records);
    }

    return results;
  }

  /**
   * Extract stage-relevant fields from a raw 1Map record.
   * Uses actual field names discovered from live API (Feb 2026).
   */
  static extractStageFields(record: OneMapRecord): OneMapStageFields {
    const str = (key: string): string | null => {
      const val = record[key];
      if (val !== undefined && val !== null && val !== '') return String(val);
      return null;
    };

    return {
      status: str('status'),
      last_modified_poles_date: str('last_modified_poles_date'),
      last_modified_poles_by: str('last_modified_poles_by'),
      poleconc: str('poleconc'),
      last_modified_signup_date: str('last_modified_signup_date'),
      last_modified_signup_by: str('last_modified_signup_by'),
      last_modified_install_date: str('last_modified_install_date'),
      last_modified_install_by: str('last_modified_install_by'),
      install: str('install'),
      last_modified_awareness_date: str('last_modified_awareness_date'),
      date_status_changed: str('date_status_changed'),
      surv_date: str('surv_date'),
      pons: str('pons'),
      sect: str('sect'),
      cons_pp: str('cons_pp'),
      cons_hi: str('cons_hi'),
    };
  }

  /**
   * Parse a 1Map record into stage completion data.
   *
   * Stage detection logic:
   * 1. Match status string against STATUS_STAGE_PATTERNS
   * 2. Apply implied stages (e.g., "Home Installation" implies permissions+poles+optical done)
   * 3. Check date fields as additional evidence
   * 4. CWC and ATP are NOT tracked in 1Map — left as false (populated from QField data)
   */
  static parseStageRecord(record: OneMapRecord): ParsedStageRecord {
    const fields = OneMapClient.extractStageFields(record);
    const status = record.status || '';

    // Track which stages are complete
    const stageComplete: Record<OneMapBuildStage, boolean> = {
      permissions: false,
      poles: false,
      cwc: false,
      optical: false,
      atp: false,
      activation: false,
    };

    // Match status patterns and apply implied stages
    for (const mapping of STATUS_STAGE_PATTERNS) {
      if (mapping.pattern.test(status)) {
        if (mapping.complete) {
          stageComplete[mapping.stage] = true;
        }
        // Apply implied stages
        if (mapping.implies) {
          for (const implied of mapping.implies) {
            stageComplete[implied] = true;
          }
        }
      }
    }

    // Date fields as additional evidence:
    // If last_modified_poles_date exists AND status is past "Pole Permission", poles are planted
    if (fields.last_modified_poles_date && stageComplete.permissions) {
      stageComplete.poles = true;
    }

    // Parse zone and PON from pole label + 1Map pons field
    const { zone_no, pon_no } = OneMapClient.parsePoleLabel(record.pole, record.site);
    // Also try to get PON from the 1Map `pons` field
    const ponFromField = fields.pons ? parseInt(fields.pons, 10) : null;
    const finalPon = pon_no || (ponFromField && !isNaN(ponFromField) ? ponFromField : null);

    return {
      dr_number: record.drp,
      prop_id: record.prop_id,
      pole: record.pole,
      site: record.site,
      status,
      zone_no,
      pon_no: finalPon,
      stages: {
        permissions_complete: stageComplete.permissions,
        permissions_date: fields.last_modified_poles_date,  // Poles date is closest to permission approval date
        poles_complete: stageComplete.poles,
        poles_date: fields.last_modified_poles_date,
        cwc_complete: stageComplete.cwc,         // Not tracked in 1Map
        cwc_date: null,
        optical_complete: stageComplete.optical,
        optical_date: fields.last_modified_signup_date,
        atp_complete: stageComplete.atp,         // Not tracked in 1Map
        atp_date: null,
        activation_complete: stageComplete.activation,
        activation_date: fields.last_modified_install_date,
      },
    };
  }

  /**
   * Parse pole label to extract zone info.
   * Examples: "MAM.P.C334" → zone C = zone 3, "LAW.P.A453" → zone A = zone 1
   */
  static parsePoleLabel(pole: string, site: string): { zone_no: number | null; pon_no: number | null } {
    if (!pole) return { zone_no: null, pon_no: null };

    // Pattern: SITE.P.XNNN where X is zone letter, NNN is number
    const match = pole.match(/\.P\.([A-Z])(\d+)/i);
    if (match && match[1]) {
      const zoneLetter = match[1].toUpperCase();
      const zoneNo = zoneLetter.charCodeAt(0) - 64; // A=1, B=2, C=3...
      return { zone_no: zoneNo, pon_no: null }; // PON comes from drops table join
    }

    return { zone_no: null, pon_no: null };
  }

  /**
   * Fetch all installations for a site and parse stage data.
   * Returns parsed records grouped for easy aggregation.
   */
  async getAllInstallationsWithStages(
    site: string,
    options: {
      maxPages?: number;
      onProgress?: (page: number, totalPages: number, recordsFetched: number) => void;
    } = {}
  ): Promise<ParsedStageRecord[]> {
    const records = await this.getAllInstallations(site, options);

    logger.info('Parsing stage data from 1Map records', {
      site,
      totalRecords: records.length,
    });

    return records.map(record => OneMapClient.parseStageRecord(record));
  }

  /**
   * Discover all field names from a 1Map site (utility for first-time setup).
   * Fetches one page and returns all field names found across records.
   */
  async discoverFields(site: string): Promise<string[]> {
    const result = await this.searchInstallations(site, { limit: 10 });
    const fieldSet = new Set<string>();

    if (result.success && result.result) {
      for (const record of result.result) {
        for (const key of Object.keys(record)) {
          fieldSet.add(key);
        }
      }
    }

    const fields = Array.from(fieldSet).sort();
    logger.info('Discovered 1Map fields', { site, fieldCount: fields.length, fields });
    return fields;
  }
}

// Factory function for creating client with env vars
export function createOneMapClient(): OneMapClient {
  const email = process.env.ONEMAP_EMAIL || 'hein@velocityfibre.co.za';
  const password = process.env.ONEMAP_PASSWORD;
  if (!password) {
    throw new Error('ONEMAP_PASSWORD environment variable is required');
  }

  return new OneMapClient({ email, password });
}
