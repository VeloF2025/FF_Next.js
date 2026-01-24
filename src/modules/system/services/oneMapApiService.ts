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
const FETCH_TIMEOUT_MS = 5000; // 5 second timeout per request (5 requests max = 25s total)

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
  ph_ups: string | null;
  status: string | null;
  pole: string | null;
  address: string | null;
  site: string | null;
  latitude: number | null;
  longitude: number | null;
  last_modified_by: string | null;
  last_modified_date: string | null;
}

interface SearchResult {
  success: boolean;
  records: OneMapRecord[];
  error?: string;
}

interface UpdateResult {
  success: boolean;
  oldValue: string | null;
  newValue: string;
  propId: string;
  error?: string;
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
        .map((c) => c.split(';')[0].trim())
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
      this.sessionCookie = sidMatch[1];

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

    // Step 2: Check if already correct
    const alreadyCorrect = records.find(
      (r) => r.ph_ont?.toUpperCase() === correctSerial.toUpperCase()
    );
    if (alreadyCorrect) {
      return {
        success: true,
        oldValue: correctSerial,
        newValue: correctSerial,
        propId: alreadyCorrect.prop_id,
        error: 'Already correct',
      };
    }

    // Step 3: Find record to update - priority order:
    // 1. Record with wrong ONT (if specified)
    // 2. Record with status "Home Installation: Installed"
    // 3. First record (if only one)
    let target: OneMapRecord | undefined;

    if (wrongSerial) {
      target = records.find(
        (r) => r.ph_ont?.toUpperCase() === wrongSerial.toUpperCase()
      );
    }

    if (!target) {
      target = records.find((r) => r.status === 'Home Installation: Installed');
    }

    if (!target && records.length === 1) {
      target = records[0];
    }

    if (!target) {
      return {
        success: false,
        oldValue: null,
        newValue: correctSerial,
        propId: '',
        error: `Multiple records found for ${drNumber}, cannot determine which to update`,
      };
    }

    // Step 4: Update the record
    const oldValue = target.ph_ont || '';
    const updateResult = await this.updateOntSerial(target.prop_id, correctSerial);

    return {
      ...updateResult,
      oldValue,
    };
  }
}

// Export singleton instance
export const oneMapApi = new OneMapApiService();

// Export types
export type { OneMapRecord, SearchResult, UpdateResult };
