/**
 * 1Map GIS API Client
 *
 * Session-based authentication with 1Map API for accessing
 * Fibertime installation data (DR records, poles, photos).
 *
 * Based on: docs/1map_integration/onemap_client.py
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'oneMapClient' });

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

// Site code to project mapping
export const SITE_PROJECT_MAP: Record<string, { name: string; code: string }> = {
  'LAW': { name: 'Lawley', code: 'PRJ-1761224913968' },
  'MOH': { name: 'Mohadin', code: 'PRJ-1761242661257' },
  'MAM': { name: 'Mamelodi', code: 'PRJ-1763722776949' },
  'VELO': { name: 'Velo Test', code: 'VELO' },
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
          _csrf: csrfValue,
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
        this.sessionCookie = sidMatch[1];
      }

      const tokenMatch = setCookieHeader.match(/csrfToken=([^;]+)/);
      if (tokenMatch) {
        this.csrfToken = tokenMatch[1];
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
}

// Factory function for creating client with env vars
export function createOneMapClient(): OneMapClient {
  const email = process.env.ONEMAP_EMAIL || 'hein@velocityfibre.co.za';
  const password = process.env.ONEMAP_PASSWORD || 'VeloF@2025';

  return new OneMapClient({ email, password });
}
