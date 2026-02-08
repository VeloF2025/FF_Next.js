/**
 * OneMap API Service
 *
 * Handles authentication and API calls to 1Map for fixing ONT serials.
 * Uses 4-step authentication flow:
 * 1. GET /login - Extract CSRF token
 * 2. POST /login - Authenticate and get session cookie
 * 3. GET /app?layer=5121 - Initialize layer access (CRITICAL!)
 * 4. Make API calls
 *
 * Layer ID: 5121 (Home Installation - Aerial)
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import { log } from '@/lib/logger';

const ONEMAP_EMAIL = process.env.ONEMAP_EMAIL || 'hein@velocityfibre.co.za';
const ONEMAP_PASSWORD = process.env.ONEMAP_PASSWORD || 'VeloF@2025';
const LAYER_ID = '5121';
const BASE_URL = 'https://www.1map.co.za';
const FETCH_TIMEOUT_MS = 30000; // 30 second timeout - 1Map search can take 10-15s under load

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

interface OneMapRecord {
  prop_id: string;
  drp: string;
  ph_ont: string | null;
  br_ser: string | null; // UPS serial field in 1Map
  status: string | null;
  pole: string | null;
  address: string | null;
  site: string | null;
  latitude: number | null;
  longitude: number | null;
  last_modified_by: string | null;
  last_modified_date: string | null;
  // Subscriber contact fields (discovered 2026-01-26)
  contact_person_name: string | null; // First name
  contact_person_surname: string | null; // Surname
  contact_number: string | null; // Phone number (e.g., 0782593117)
  email_address: string | null;
  language: string | null;
  survey_date: string | null;
}

interface SearchResult {
  success: boolean;
  records: OneMapRecord[];
  error?: string;
}

interface PropUpdate {
  propId: string;
  oldValue: string | null;
  newValue: string;
  updated: boolean;
}

interface DualPropUpdate {
  propId: string;
  ont: { oldValue: string | null; newValue: string; updated: boolean };
  ups: { oldValue: string | null; newValue: string | null; updated: boolean };
}

interface UpdateResult {
  success: boolean;
  oldValue: string | null;
  newValue: string;
  propId: string;
  error?: string;
  // Multi-prop_id tracking: ALL records for the DR
  allPropUpdates?: PropUpdate[];
  totalRecords?: number;
  updatedCount?: number;
  alreadyCorrectCount?: number;
}

interface DualUpdateResult {
  success: boolean;
  propId: string;
  ont: {
    oldValue: string | null;
    newValue: string;
    updated: boolean;
  };
  ups: {
    oldValue: string | null;
    newValue: string | null;
    updated: boolean;
  };
  error?: string;
  // Multi-prop_id tracking: ALL records for the DR
  allPropUpdates?: DualPropUpdate[];
  totalRecords?: number;
  updatedCount?: number;
  alreadyCorrectCount?: number;
}

class OneMapApiService {
  private sessionCookie: string | null = null;
  private sessionInitializedAt: number | null = null;
  private readonly SESSION_TIMEOUT_MS = 25 * 60 * 1000; // 25 minutes

  /**
   * Check if we have a valid session
   */
  private hasValidSession(): boolean {
    if (!this.sessionCookie || !this.sessionInitializedAt) {
      return false;
    }
    const elapsed = Date.now() - this.sessionInitializedAt;
    return elapsed < this.SESSION_TIMEOUT_MS;
  }

  /**
   * 4-step authentication flow
   */
  async authenticate(): Promise<boolean> {
    try {
      // Step 1: GET login page for CSRF token
      log.info('OneMapAPI', 'Step 1: Getting CSRF token...');
      const loginPage = await fetchWithTimeout(`${BASE_URL}/login`);
      const html = await loginPage.text();
      const csrfMatch = html.match(/name="_csrf"\s+value="([^"]+)"/);
      const csrf = csrfMatch ? csrfMatch[1] : null;

      if (!csrf) {
        log.error('OneMapAPI', 'Failed to extract CSRF token');
        return false;
      }

      // Extract cookies from login page
      const setCookie = loginPage.headers.get('set-cookie') || '';
      const cookieJar = setCookie
        .split(',')
        .map((c) => (c.split(';')[0] || '').trim())
        .join('; ');

      // Step 2: POST login with CSRF
      log.info('OneMapAPI', 'Step 2: Authenticating...');
      const loginResponse = await fetchWithTimeout(`${BASE_URL}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: cookieJar,
        },
        body: new URLSearchParams({
          _csrf: csrf,
          email: ONEMAP_EMAIL,
          password: ONEMAP_PASSWORD,
        }).toString(),
        redirect: 'manual',
      });

      // Extract session cookie
      const respCookies = loginResponse.headers.get('set-cookie') || '';
      const sidMatch = respCookies.match(/connect\.sid=([^;]+)/);
      if (!sidMatch) {
        log.error('OneMapAPI', 'Failed to get session cookie');
        return false;
      }
      this.sessionCookie = sidMatch[1] || '';

      // Step 3: Visit app to initialize layer access (CRITICAL!)
      log.info('OneMapAPI', 'Step 3: Initializing layer access...');
      await fetchWithTimeout(`${BASE_URL}/app?layer=${LAYER_ID}`, {
        headers: { Cookie: `connect.sid=${this.sessionCookie}` },
      });

      this.sessionInitializedAt = Date.now();
      log.info('OneMapAPI', 'Authentication successful');
      return true;
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      log.error('OneMapAPI', isTimeout ? 'Authentication timed out' : 'Authentication failed', { error });
      return false;
    }
  }

  /**
   * Ensure we have a valid session
   */
  private async ensureSession(): Promise<boolean> {
    if (this.hasValidSession()) {
      return true;
    }
    return this.authenticate();
  }

  /**
   * Search for a DR in 1Map
   */
  async searchDR(drNumber: string): Promise<SearchResult> {
    try {
      if (!(await this.ensureSession())) {
        return { success: false, records: [], error: 'Authentication failed' };
      }

      const formData = new URLSearchParams({
        ungeocoded: 'false',
        left: '0',
        bottom: '0',
        right: '0',
        top: '0',
        selfilter: '',
        action: 'get',
        email: ONEMAP_EMAIL,
        layerid: LAYER_ID,
        sort: 'prop_id',
        templateExpression: '',
        q: drNumber,
        page: '1',
        start: '0',
        limit: '50',
      });

      const response = await fetchWithTimeout(`${BASE_URL}/api/apps/app/getattributes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Cookie: `connect.sid=${this.sessionCookie}`,
        },
        body: formData.toString(),
      });

      const result = await response.json();

      if (!result.success) {
        return { success: false, records: [], error: 'API returned failure' };
      }

      // Filter for exact DR match
      const records = (result.result || []).filter(
        (r: OneMapRecord) => r.drp === drNumber
      );

      return { success: true, records };
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      log.error('OneMapAPI', isTimeout ? 'Search timed out' : 'Search failed', { drNumber, error });
      return {
        success: false,
        records: [],
        error: isTimeout ? '1Map API timeout - try again' : (error instanceof Error ? error.message : 'Unknown error'),
      };
    }
  }

  /**
   * Update ONT serial in 1Map
   *
   * @param propId - The property ID to update
   * @param newOntSerial - The new ONT serial value
   * @returns UpdateResult with success status and old/new values
   */
  async updateOntSerial(propId: string, newOntSerial: string): Promise<UpdateResult> {
    try {
      if (!(await this.ensureSession())) {
        return {
          success: false,
          oldValue: null,
          newValue: newOntSerial,
          propId,
          error: 'Authentication failed',
        };
      }

      const formData = new URLSearchParams({
        action: 'update',
        layerid: LAYER_ID,
        sort: 'prop_id',
        templateExpression: '',
        start: '0',
        limit: '50',
        bottom: '0',
        left: '0',
        right: '0',
        top: '0',
        selfilter: 'null',
        ungeocoded: 'false',
        items: JSON.stringify({ prop_id: propId, ph_ont: newOntSerial }),
      });

      const response = await fetchWithTimeout(`${BASE_URL}/api/apps/app/attributes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Cookie: `connect.sid=${this.sessionCookie}`,
        },
        body: formData.toString(),
      });

      const text = await response.text();
      const success = response.ok && text.includes('"success":true');

      if (!success) {
        log.error('OneMapAPI', 'Update failed', { propId, response: text });
        return {
          success: false,
          oldValue: null,
          newValue: newOntSerial,
          propId,
          error: 'API returned failure',
        };
      }

      log.info('OneMapAPI', 'ONT serial updated', { propId, newOntSerial });
      return {
        success: true,
        oldValue: null, // Caller should provide this from pre-search
        newValue: newOntSerial,
        propId,
      };
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      log.error('OneMapAPI', isTimeout ? 'Update timed out' : 'Update failed', { propId, error });
      return {
        success: false,
        oldValue: null,
        newValue: newOntSerial,
        propId,
        error: isTimeout ? '1Map API timeout - try again' : (error instanceof Error ? error.message : 'Unknown error'),
      };
    }
  }

  /**
   * Update both ONT and UPS serials in 1Map
   *
   * @param propId - The property ID to update
   * @param newOntSerial - The new ONT serial value
   * @param newUpsSerial - The new UPS serial value (optional)
   * @returns DualUpdateResult with success status and old/new values for both fields
   */
  async updateOntAndUpsSerial(
    propId: string,
    newOntSerial: string,
    newUpsSerial?: string | null
  ): Promise<DualUpdateResult> {
    try {
      if (!(await this.ensureSession())) {
        return {
          success: false,
          propId,
          ont: { oldValue: null, newValue: newOntSerial, updated: false },
          ups: { oldValue: null, newValue: newUpsSerial || null, updated: false },
          error: 'Authentication failed',
        };
      }

      // Build update payload - always update ONT, optionally update UPS
      const updatePayload: Record<string, string> = {
        prop_id: propId,
        ph_ont: newOntSerial,
      };

      if (newUpsSerial !== undefined && newUpsSerial !== null) {
        updatePayload.br_ser = newUpsSerial; // 1Map uses br_ser for UPS serial (empty string = clear)
      }

      const formData = new URLSearchParams({
        action: 'update',
        layerid: LAYER_ID,
        sort: 'prop_id',
        templateExpression: '',
        start: '0',
        limit: '50',
        bottom: '0',
        left: '0',
        right: '0',
        top: '0',
        selfilter: 'null',
        ungeocoded: 'false',
        items: JSON.stringify(updatePayload),
      });

      const response = await fetchWithTimeout(`${BASE_URL}/api/apps/app/attributes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Cookie: `connect.sid=${this.sessionCookie}`,
        },
        body: formData.toString(),
      });

      const text = await response.text();
      const success = response.ok && text.includes('"success":true');

      if (!success) {
        log.error('OneMapAPI', 'Dual update failed', { propId, response: text });
        return {
          success: false,
          propId,
          ont: { oldValue: null, newValue: newOntSerial, updated: false },
          ups: { oldValue: null, newValue: newUpsSerial || null, updated: false },
          error: 'API returned failure',
        };
      }

      log.info('OneMapAPI', 'ONT and UPS serials updated', {
        propId,
        newOntSerial,
        newUpsSerial: newUpsSerial || 'not updated',
      });

      return {
        success: true,
        propId,
        ont: { oldValue: null, newValue: newOntSerial, updated: true },
        ups: { oldValue: null, newValue: newUpsSerial || null, updated: !!newUpsSerial },
      };
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      log.error('OneMapAPI', isTimeout ? 'Dual update timed out' : 'Dual update failed', { propId, error });
      return {
        success: false,
        propId,
        ont: { oldValue: null, newValue: newOntSerial, updated: false },
        ups: { oldValue: null, newValue: newUpsSerial || null, updated: false },
        error: isTimeout ? '1Map API timeout - try again' : (error instanceof Error ? error.message : 'Unknown error'),
      };
    }
  }

  /**
   * Fix a DR's ONT serial - searches, selects correct record, and updates
   *
   * @param drNumber - The DR number to fix
   * @param correctSerial - The correct ONT serial to set
   * @param wrongSerial - Optional: The wrong serial to help identify the record
   */
  async fixDrOntSerial(
    drNumber: string,
    correctSerial: string,
    wrongSerial?: string
  ): Promise<UpdateResult> {
    // Step 1: Search for the DR
    const searchResult = await this.searchDR(drNumber);
    if (!searchResult.success || searchResult.records.length === 0) {
      return {
        success: false,
        oldValue: null,
        newValue: correctSerial,
        propId: '',
        error: searchResult.error || `DR ${drNumber} not found in 1Map`,
      };
    }

    const records = searchResult.records;
    const allPropUpdates: PropUpdate[] = [];

    // Categorize: correct vs wrong/empty
    const correctRecords = records.filter(
      (r) => r.ph_ont?.toUpperCase() === correctSerial.toUpperCase()
    );
    const wrongRecords = records.filter(
      (r) => r.ph_ont?.toUpperCase() !== correctSerial.toUpperCase()
    );

    // Track already correct records
    for (const r of correctRecords) {
      allPropUpdates.push({
        propId: r.prop_id,
        oldValue: r.ph_ont,
        newValue: correctSerial,
        updated: false,
      });
    }

    // Update ALL records that don't have the correct serial
    for (let i = 0; i < wrongRecords.length; i++) {
      const rec = wrongRecords[i]!;
      const updateResult = await this.updateOntSerial(rec.prop_id, correctSerial);
      allPropUpdates.push({
        propId: rec.prop_id,
        oldValue: rec.ph_ont,
        newValue: correctSerial,
        updated: updateResult.success,
      });
      // Small delay between API calls to avoid rate limiting
      if (i < wrongRecords.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    const updatedCount = allPropUpdates.filter((u) => u.updated).length;
    const alreadyCorrectCount = correctRecords.length;

    // If ALL records already had correct serial
    if (wrongRecords.length === 0) {
      return {
        success: true,
        oldValue: correctSerial,
        newValue: correctSerial,
        propId: correctRecords[0]?.prop_id || '',
        error: 'Already correct',
        allPropUpdates,
        totalRecords: records.length,
        updatedCount: 0,
        alreadyCorrectCount,
      };
    }

    // Determine primary target for backward-compatible fields
    let primaryTarget = wrongRecords[0]!;
    if (wrongSerial) {
      const match = wrongRecords.find(
        (r) => r.ph_ont?.toUpperCase() === wrongSerial.toUpperCase()
      );
      if (match) primaryTarget = match;
    }

    log.info('OneMapAPI', `Fixed ${updatedCount}/${records.length} records for ${drNumber}`, {
      drNumber,
      updatedCount,
      alreadyCorrectCount,
      totalRecords: records.length,
      propIds: allPropUpdates.map((u) => `${u.propId}:${u.updated ? 'fixed' : 'ok'}`),
    });

    return {
      success: updatedCount > 0,
      oldValue: primaryTarget.ph_ont || null,
      newValue: correctSerial,
      propId: primaryTarget.prop_id,
      allPropUpdates,
      totalRecords: records.length,
      updatedCount,
      alreadyCorrectCount,
    };
  }

  /**
   * Fix a DR's ONT and UPS serials - searches, selects correct record, and updates both fields
   *
   * Used when the wrong 1Map serial (Column V) is detected as a UPS serial (starts with GU18).
   * This indicates the technician swapped ONT and UPS serials.
   *
   * @param drNumber - The DR number to fix
   * @param correctOntSerial - The correct ONT serial to set (Column B)
   * @param correctUpsSerial - The correct UPS serial to set (derived from Column V if starts with GU18)
   * @param wrongSerial - Optional: The wrong serial currently in 1Map (helps identify the record)
   */
  async fixDrOntAndUpsSerial(
    drNumber: string,
    correctOntSerial: string,
    correctUpsSerial?: string | null,
    wrongSerial?: string
  ): Promise<DualUpdateResult> {
    // Step 1: Search for the DR
    const searchResult = await this.searchDR(drNumber);
    if (!searchResult.success || searchResult.records.length === 0) {
      return {
        success: false,
        propId: '',
        ont: { oldValue: null, newValue: correctOntSerial, updated: false },
        ups: { oldValue: null, newValue: correctUpsSerial || null, updated: false },
        error: searchResult.error || `DR ${drNumber} not found in 1Map`,
      };
    }

    const records = searchResult.records;
    const allPropUpdates: DualPropUpdate[] = [];

    // Categorize: fully correct vs needing update
    const correctRecords = records.filter((r) => {
      const ontMatch = r.ph_ont?.toUpperCase() === correctOntSerial.toUpperCase();
      const upsMatch = !correctUpsSerial || r.br_ser?.toUpperCase() === correctUpsSerial.toUpperCase();
      return ontMatch && upsMatch;
    });
    const wrongRecords = records.filter((r) => {
      const ontMatch = r.ph_ont?.toUpperCase() === correctOntSerial.toUpperCase();
      const upsMatch = !correctUpsSerial || r.br_ser?.toUpperCase() === correctUpsSerial.toUpperCase();
      return !(ontMatch && upsMatch);
    });

    // Track already correct
    for (const r of correctRecords) {
      allPropUpdates.push({
        propId: r.prop_id,
        ont: { oldValue: r.ph_ont, newValue: correctOntSerial, updated: false },
        ups: { oldValue: r.br_ser, newValue: correctUpsSerial || null, updated: false },
      });
    }

    // Update ALL records that need fixing
    for (let i = 0; i < wrongRecords.length; i++) {
      const rec = wrongRecords[i]!;
      const updateResult = await this.updateOntAndUpsSerial(
        rec.prop_id,
        correctOntSerial,
        correctUpsSerial
      );
      allPropUpdates.push({
        propId: rec.prop_id,
        ont: { oldValue: rec.ph_ont, newValue: correctOntSerial, updated: updateResult.ont.updated },
        ups: { oldValue: rec.br_ser, newValue: correctUpsSerial || null, updated: updateResult.ups.updated },
      });
      if (i < wrongRecords.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    const updatedCount = allPropUpdates.filter((u) => u.ont.updated || u.ups.updated).length;
    const alreadyCorrectCount = correctRecords.length;

    // If ALL records already correct
    if (wrongRecords.length === 0) {
      return {
        success: true,
        propId: correctRecords[0]?.prop_id || '',
        ont: { oldValue: correctOntSerial, newValue: correctOntSerial, updated: false },
        ups: { oldValue: correctRecords[0]?.br_ser || null, newValue: correctUpsSerial || null, updated: false },
        error: 'Already correct',
        allPropUpdates,
        totalRecords: records.length,
        updatedCount: 0,
        alreadyCorrectCount,
      };
    }

    // Primary target for backward compat
    let primaryTarget = wrongRecords[0]!;
    if (wrongSerial) {
      const match = wrongRecords.find(
        (r) => r.ph_ont?.toUpperCase() === wrongSerial.toUpperCase()
      );
      if (match) primaryTarget = match;
    }

    log.info('OneMapAPI', `Fixed ${updatedCount}/${records.length} records for ${drNumber} (ONT+UPS)`, {
      drNumber,
      updatedCount,
      alreadyCorrectCount,
      totalRecords: records.length,
    });

    return {
      success: updatedCount > 0,
      propId: primaryTarget.prop_id,
      ont: { oldValue: primaryTarget.ph_ont || null, newValue: correctOntSerial, updated: updatedCount > 0 },
      ups: { oldValue: primaryTarget.br_ser || null, newValue: correctUpsSerial || null, updated: updatedCount > 0 && !!correctUpsSerial },
      allPropUpdates,
      totalRecords: records.length,
      updatedCount,
      alreadyCorrectCount,
    };
  }
  /**
   * Update a record's status field on 1Map
   */
  async updateRecordStatus(
    propId: string,
    newStatus: string
  ): Promise<{ success: boolean; propId: string; oldStatus?: string; newStatus: string; error?: string }> {
    try {
      if (!(await this.ensureSession())) {
        return { success: false, propId, newStatus, error: 'Authentication failed' };
      }

      const formData = new URLSearchParams({
        action: 'update',
        layerid: LAYER_ID,
        sort: 'prop_id',
        templateExpression: '',
        start: '0',
        limit: '50',
        bottom: '0',
        left: '0',
        right: '0',
        top: '0',
        selfilter: 'null',
        ungeocoded: 'false',
        items: JSON.stringify({ prop_id: propId, status: newStatus }),
      });

      const response = await fetchWithTimeout(`${BASE_URL}/api/apps/app/attributes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Cookie: `connect.sid=${this.sessionCookie}`,
        },
        body: formData.toString(),
      });

      const text = await response.text();
      const success = response.ok && text.includes('"success":true');

      if (!success) {
        log.error('OneMapAPI', 'Status update failed', { propId, newStatus, response: text });
        return { success: false, propId, newStatus, error: 'API returned failure' };
      }

      log.info('OneMapAPI', 'Record status updated', { propId, newStatus });
      return { success: true, propId, newStatus };
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      log.error('OneMapAPI', isTimeout ? 'Status update timed out' : 'Status update failed', { propId, error });
      return {
        success: false,
        propId,
        newStatus,
        error: isTimeout ? '1Map API timeout' : (error instanceof Error ? error.message : 'Unknown error'),
      };
    }
  }
}

// Export singleton instance
export const oneMapApi = new OneMapApiService();

// Export types
export type { OneMapRecord, SearchResult, UpdateResult, DualUpdateResult, PropUpdate, DualPropUpdate };
