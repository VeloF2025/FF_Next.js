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

  constructor(config: OneMapClientConfig) {
    this.email = config.email;
    this.password = config.password;
    this.baseUrl = config.baseUrl || 'https://www.1map.co.za';
  }

  /**
   * Authenticate with 1Map using session-based login
   */
  async authenticate(): Promise<boolean> {
    logger.info('Authenticating with 1Map', { email: this.email });

    try {
      const response = await fetch(`${this.baseUrl}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          email: this.email,
          password: this.password,
        }).toString(),
        redirect: 'manual',
      });

      // Extract cookies from response
      const setCookieHeader = response.headers.get('set-cookie');
      if (setCookieHeader) {
        // Parse connect.sid cookie
        const sidMatch = setCookieHeader.match(/connect\.sid=([^;]+)/);
        if (sidMatch) {
          this.sessionCookie = sidMatch[1];
        }

        // Parse csrfToken if present
        const csrfMatch = setCookieHeader.match(/csrfToken=([^;]+)/);
        if (csrfMatch) {
          this.csrfToken = csrfMatch[1];
        }
      }

      if (this.sessionCookie) {
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
   * Search for drops
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

    try {
      const response = await fetch(`${this.baseUrl}/api/apps/app/getattributes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Cookie': this.getCookies(),
        },
        body: formData.toString(),
      });

      if (!response.ok) {
        throw new Error(`1Map API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as OneMapSearchResult;

      logger.debug('1Map search completed', {
        query,
        page,
        results: result.result?.length || 0,
        totalPages: result.total_pages,
      });

      return result;
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
      const result = await this.searchInstallations(site, { page, limit: 50 });

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
  const email = process.env.ONEMAP_EMAIL;
  const password = process.env.ONEMAP_PASSWORD;

  if (!email || !password) {
    throw new Error('ONEMAP_EMAIL and ONEMAP_PASSWORD environment variables required');
  }

  return new OneMapClient({ email, password });
}
