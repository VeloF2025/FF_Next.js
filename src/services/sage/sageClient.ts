/**
 * Sage Business Cloud Accounting API Client (South Africa)
 *
 * OAuth 2.0 client for SageOne API (South Africa)
 *
 * Authentication: OAuth 2.0 Authorization Code Flow
 * - Authorization: https://www.sageone.com/oauth2/auth/central?filter=apiv3.1
 * - Token: https://oauth.accounting.sage.com/token
 * - API calls use Bearer token
 * - Access tokens expire in 5 minutes
 * - Refresh tokens expire in 31 days
 *
 * API Docs: https://developer.sage.com/accounting/guides/authenticating/authentication/
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'sageClient' });

// ============================================================================
// Constants
// ============================================================================

const SAGE_AUTH_URL = 'https://www.sageone.com/oauth2/auth/central';
const SAGE_TOKEN_URL = 'https://oauth.accounting.sage.com/token';
const SAGE_API_BASE_URL = 'https://accounting.sageone.co.za';
const DEFAULT_API_VERSION = '2.0.0';

// Token expiry buffers (refresh before actual expiry)
const ACCESS_TOKEN_BUFFER_MS = 30 * 1000; // 30 seconds before expiry

// ============================================================================
// Types
// ============================================================================

export interface SageOAuthConfig {
  clientId: string;
  clientSecret: string;
  companyId: string;
  baseUrl?: string;
  apiVersion?: string;
  // Tokens (optional - can be set later)
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
}

// Legacy config interface for backwards compatibility
export interface SageClientConfig {
  apiKey?: string;
  username?: string;
  password?: string;
  clientId?: string;
  clientSecret?: string;
  companyId: string;
  baseUrl?: string;
  apiVersion?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
}

export interface SageTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  tokenType: string;
}

export interface SageTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  token_type: string;
}

export interface SageSupplier {
  ID: string;
  Name: string;
  Category?: { ID: string; Description: string };
  TaxReference?: string;
  ContactName?: string;
  Telephone?: string;
  Fax?: string;
  Mobile?: string;
  Email?: string;
  WebAddress?: string;
  Active: boolean;
  Balance?: number;
  CreditLimit?: number;
  PostalAddress01?: string;
  PostalAddress02?: string;
  PostalAddress03?: string;
  PostalAddress04?: string;
  PostalAddress05?: string;
  DeliveryAddress01?: string;
  DeliveryAddress02?: string;
  DeliveryAddress03?: string;
  DeliveryAddress04?: string;
  DeliveryAddress05?: string;
  AutoAllocateToOldestInvoice?: boolean;
  TextField1?: string;
  TextField2?: string;
  TextField3?: string;
  NumericField1?: number;
  NumericField2?: number;
  NumericField3?: number;
  YesNoField1?: boolean;
  YesNoField2?: boolean;
  YesNoField3?: boolean;
  DateField1?: string;
  DateField2?: string;
  DateField3?: string;
  DefaultDiscountPercentage?: number;
  DefaultTaxTypeID?: string;
  DueDateMethodId?: number;
  DueDateMethodValue?: number;
  CurrencyId?: string;
  CurrencySymbol?: string;
  HasActivity?: boolean;
  DefaultAccount?: { ID: string; Name: string };
  Created?: string;
  Modified?: string;
}

export interface SageSupplierInvoice {
  ID: string;
  DueDate: string;
  Paid: boolean;
  Status: string;
  FromDocument?: string;
  Locked: boolean;
  HasAdditionalCost: boolean;
  SupplierID: string;
  SupplierName: string;
  Supplier?: SageSupplier;
  Modified?: string;
  Created?: string;
  Date: string;
  Inclusive: boolean;
  DiscountPercentage?: number;
  TaxReference?: string;
  DocumentNumber?: string;
  Reference?: string;
  Message?: string;
  Discount?: number;
  Exclusive?: number;
  Tax?: number;
  Rounding?: number;
  Total?: number;
  AmountDue?: number;
  PostalAddress01?: string;
  PostalAddress02?: string;
  PostalAddress03?: string;
  PostalAddress04?: string;
  PostalAddress05?: string;
  DeliveryAddress01?: string;
  DeliveryAddress02?: string;
  DeliveryAddress03?: string;
  DeliveryAddress04?: string;
  DeliveryAddress05?: string;
  Printed?: boolean;
  TaxPeriodId?: string;
  Editable?: boolean;
  Lines?: SageInvoiceLine[];
}

export interface SageInvoiceLine {
  ID?: string;
  SelectionId?: string;
  TaxTypeId?: string;
  Description: string;
  UnitPriceExclusive?: number;
  UnitPriceInclusive?: number;
  DiscountPercentage?: number;
  Quantity?: number;
  Unit?: number;
  Exclusive?: number;
  Discount?: number;
  Tax?: number;
  Total?: number;
  Account?: { ID: string; Name: string };
}

export interface SageSupplierPayment {
  ID: string;
  SupplierID: string;
  SupplierName: string;
  Date: string;
  PaymentMethod?: number;
  DocumentNumber?: string;
  Reference?: string;
  Description?: string;
  Total?: number;
  Reconciled?: boolean;
  BankAccountId?: string;
  Taxable?: boolean;
  TaxTypeId?: string;
  Locked?: boolean;
  Editable?: boolean;
  Modified?: string;
  Created?: string;
}

export interface SageAccount {
  ID: string;
  Name: string;
  Category?: { ID: string; Description: string };
  Active: boolean;
  Balance?: number;
  Description?: string;
  ReportingGroupId?: string;
  UnallocatedAccount?: boolean;
  IsTaxLocked?: boolean;
  Modified?: string;
  Created?: string;
  AccountType?: number;
  HasActivity?: boolean;
  DefaultTaxTypeId?: string;
  DefaultTaxType?: { ID: string; Name: string };
}

export interface SagePurchaseOrder {
  ID?: string;
  SupplierID: string;
  SupplierName?: string;
  Date: string;
  DeliveryDate?: string;
  Reference?: string;
  Status?: string;
  StatusId?: number;
  Modified?: string;
  Created?: string;
  Exclusive?: number;
  Discount?: number;
  Tax?: number;
  Total?: number;
  Printed?: boolean;
  Editable?: boolean;
  Lines: SagePurchaseOrderLine[];
}

export interface SagePurchaseOrderLine {
  ID?: string;
  Description: string;
  Quantity: number;
  UnitPriceExclusive?: number;
  UnitPriceInclusive?: number;
  DiscountPercentage?: number;
  TaxTypeId?: string;
  AccountID?: string;
  Account?: { ID: string; Name: string };
  Unit?: number;
  Exclusive?: number;
  Discount?: number;
  Tax?: number;
  Total?: number;
}

export interface SageApiResponse<T> {
  TotalResults?: number;
  ReturnedResults?: number;
  Results: T[];
}

export interface SageApiError {
  Message: string;
  ErrorCode?: string;
  Details?: string;
  message?: string; // Some endpoints use lowercase
}

// Callback for token refresh (to persist updated tokens)
export type TokenRefreshCallback = (tokens: SageTokens) => Promise<void>;

// ============================================================================
// Sage Client Class - OAuth 2.0
// ============================================================================

export class SageClient {
  private baseUrl: string;
  private apiVersion: string;
  private clientId: string;
  private clientSecret: string;
  private companyId: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private expiresAt: Date | null = null;
  private onTokenRefresh: TokenRefreshCallback | null = null;

  constructor(config: SageOAuthConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.companyId = config.companyId;
    this.baseUrl = config.baseUrl || SAGE_API_BASE_URL;
    this.apiVersion = config.apiVersion || DEFAULT_API_VERSION;

    if (config.accessToken) {
      this.accessToken = config.accessToken;
    }
    if (config.refreshToken) {
      this.refreshToken = config.refreshToken;
    }
    if (config.expiresAt) {
      this.expiresAt = config.expiresAt;
    }
  }

  // ==========================================================================
  // OAuth 2.0 Methods
  // ==========================================================================

  /**
   * Generate OAuth authorization URL
   * User should be redirected to this URL to authorize the application
   */
  getAuthorizationUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: 'full_access',
      state: state,
    });

    // SA Sage uses filter parameter to specify API version
    return `${SAGE_AUTH_URL}?filter=apiv3.1&${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code: string, redirectUri: string): Promise<SageTokens> {
    logger.info('Exchanging authorization code for tokens');

    const response = await fetch(SAGE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Token exchange failed', { status: response.status, error: errorText });
      throw new Error(`Token exchange failed: ${errorText}`);
    }

    const data: SageTokenResponse = await response.json();

    const tokens: SageTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      tokenType: data.token_type,
    };

    // Store tokens internally
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    this.expiresAt = tokens.expiresAt;

    logger.info('Token exchange successful', { expiresIn: data.expires_in });

    return tokens;
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(): Promise<SageTokens> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available. Please re-authorize.');
    }

    logger.info('Refreshing access token');

    const response = await fetch(SAGE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Token refresh failed', { status: response.status, error: errorText });

      // If refresh fails with 400/401, the refresh token may be expired
      if (response.status === 400 || response.status === 401) {
        throw new Error('Refresh token expired. Please re-authorize with Sage.');
      }

      throw new Error(`Token refresh failed: ${errorText}`);
    }

    const data: SageTokenResponse = await response.json();

    const tokens: SageTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      tokenType: data.token_type,
    };

    // Store tokens internally
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    this.expiresAt = tokens.expiresAt;

    // Call the callback to persist tokens if set
    if (this.onTokenRefresh) {
      await this.onTokenRefresh(tokens);
    }

    logger.info('Token refresh successful', { expiresIn: data.expires_in });

    return tokens;
  }

  /**
   * Set callback for when tokens are refreshed
   * This allows the caller to persist updated tokens to the database
   */
  setTokenRefreshCallback(callback: TokenRefreshCallback): void {
    this.onTokenRefresh = callback;
  }

  /**
   * Get current tokens
   */
  getTokens(): SageTokens | null {
    if (!this.accessToken || !this.refreshToken || !this.expiresAt) {
      return null;
    }

    return {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      expiresAt: this.expiresAt,
      tokenType: 'Bearer',
    };
  }

  /**
   * Set tokens (e.g., from database)
   */
  setTokens(tokens: SageTokens): void {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    this.expiresAt = tokens.expiresAt;
  }

  /**
   * Check if access token is expired or about to expire
   */
  isTokenExpired(): boolean {
    if (!this.expiresAt) return true;
    return new Date() >= new Date(this.expiresAt.getTime() - ACCESS_TOKEN_BUFFER_MS);
  }

  /**
   * Check if we have valid tokens
   */
  hasValidTokens(): boolean {
    return !!this.accessToken && !!this.refreshToken;
  }

  // ==========================================================================
  // HTTP Methods
  // ==========================================================================

  /**
   * Ensure we have a valid access token, refreshing if needed
   */
  private async ensureValidToken(): Promise<void> {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Please authorize with Sage first.');
    }

    if (this.isTokenExpired()) {
      await this.refreshAccessToken();
    }
  }

  /**
   * Make authenticated API request using Bearer token
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    await this.ensureValidToken();

    const url = `${this.baseUrl}/api/${this.apiVersion}/${endpoint}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    logger.debug('Sage API request', { method, endpoint });

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
      logger.warn('Rate limited by Sage API', { retryAfter: waitTime });
      throw new Error(`Rate limited. Retry after ${waitTime}ms`);
    }

    // Handle auth errors - try to refresh token once
    if (response.status === 401) {
      logger.warn('Got 401, attempting token refresh');
      try {
        await this.refreshAccessToken();
        // Retry the request with new token
        const retryResponse = await fetch(url, {
          method,
          headers: {
            ...headers,
            'Authorization': `Bearer ${this.accessToken}`,
          },
          body: body ? JSON.stringify(body) : undefined,
        });

        if (!retryResponse.ok) {
          const errorText = await retryResponse.text();
          throw new Error(`Sage API error after token refresh (${retryResponse.status}): ${errorText}`);
        }

        return await retryResponse.json();
      } catch (refreshError) {
        logger.error('Token refresh failed after 401', { error: refreshError });
        throw new Error('Authentication failed. Please re-authorize with Sage.');
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      let errorData: SageApiError;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { Message: errorText };
      }

      logger.error('Sage API error', {
        status: response.status,
        endpoint,
        error: errorData
      });

      const errorMessage = errorData.Message || errorData.message || 'Unknown error';

      if (response.status === 403) {
        throw new Error(`Access denied: ${errorMessage}. Please check your Sage permissions.`);
      }

      throw new Error(`Sage API error (${response.status}): ${errorMessage}`);
    }

    const data = await response.json();
    return data as T;
  }

  private async get<T>(endpoint: string): Promise<T> {
    return this.request<T>('GET', endpoint);
  }

  private async post<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>('POST', endpoint, body);
  }

  private async put<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', endpoint, body);
  }

  // ==========================================================================
  // Suppliers
  // ==========================================================================

  /**
   * Get all suppliers
   */
  async getSuppliers(options?: {
    skip?: number;
    take?: number;
    filter?: string;
  }): Promise<SageApiResponse<SageSupplier>> {
    const params = new URLSearchParams();
    if (options?.skip) params.append('$skip', String(options.skip));
    if (options?.take) params.append('$top', String(options.take));
    if (options?.filter) params.append('$filter', options.filter);

    const query = params.toString();
    const endpoint = `Supplier/Get${query ? `?${query}` : ''}`;

    return this.get<SageApiResponse<SageSupplier>>(endpoint);
  }

  /**
   * Get supplier by ID
   */
  async getSupplier(id: string): Promise<SageSupplier> {
    return this.get<SageSupplier>(`Supplier/Get/${id}`);
  }

  /**
   * Create a new supplier
   */
  async createSupplier(supplier: Partial<SageSupplier>): Promise<SageSupplier> {
    return this.post<SageSupplier>('Supplier/Save', supplier);
  }

  /**
   * Update an existing supplier
   */
  async updateSupplier(supplier: SageSupplier): Promise<SageSupplier> {
    return this.put<SageSupplier>('Supplier/Save', supplier);
  }

  // ==========================================================================
  // Supplier Invoices
  // ==========================================================================

  /**
   * Get supplier invoices with optional filtering
   */
  async getSupplierInvoices(options?: {
    skip?: number;
    take?: number;
    filter?: string;
    includeDetail?: boolean;
  }): Promise<SageApiResponse<SageSupplierInvoice>> {
    const params = new URLSearchParams();
    if (options?.skip) params.append('$skip', String(options.skip));
    if (options?.take) params.append('$top', String(options.take));
    if (options?.filter) params.append('$filter', options.filter);
    if (options?.includeDetail) params.append('$includeDetail', 'true');

    const query = params.toString();
    const endpoint = `SupplierInvoice/Get${query ? `?${query}` : ''}`;

    return this.get<SageApiResponse<SageSupplierInvoice>>(endpoint);
  }

  /**
   * Get supplier invoices modified since a date
   */
  async getSupplierInvoicesSince(since: Date): Promise<SageApiResponse<SageSupplierInvoice>> {
    const isoDate = since.toISOString();
    return this.getSupplierInvoices({
      filter: `Modified gt datetime'${isoDate}'`,
      includeDetail: true,
    });
  }

  /**
   * Get supplier invoice by ID
   */
  async getSupplierInvoice(id: string): Promise<SageSupplierInvoice> {
    return this.get<SageSupplierInvoice>(`SupplierInvoice/Get/${id}`);
  }

  // ==========================================================================
  // Supplier Payments
  // ==========================================================================

  /**
   * Get supplier payments with optional filtering
   */
  async getSupplierPayments(options?: {
    skip?: number;
    take?: number;
    filter?: string;
    pageSize?: number;
    fromDate?: string;
  }): Promise<SageApiResponse<SageSupplierPayment>> {
    const params = new URLSearchParams();
    if (options?.skip) params.append('$skip', String(options.skip));
    if (options?.take || options?.pageSize) params.append('$top', String(options.take || options.pageSize));
    if (options?.filter) params.append('$filter', options.filter);
    if (options?.fromDate) params.append('$filter', `Date ge datetime'${options.fromDate}'`);

    const query = params.toString();
    const endpoint = `SupplierPayment/Get${query ? `?${query}` : ''}`;

    return this.get<SageApiResponse<SageSupplierPayment>>(endpoint);
  }

  /**
   * Get supplier payments modified since a date
   */
  async getSupplierPaymentsSince(since: Date): Promise<SageApiResponse<SageSupplierPayment>> {
    const isoDate = since.toISOString();
    return this.getSupplierPayments({
      filter: `Modified gt datetime'${isoDate}'`,
    });
  }

  /**
   * Get supplier payment by ID
   */
  async getSupplierPayment(id: string): Promise<SageSupplierPayment> {
    return this.get<SageSupplierPayment>(`SupplierPayment/Get/${id}`);
  }

  // ==========================================================================
  // Purchase Orders
  // ==========================================================================

  /**
   * Get purchase orders
   */
  async getPurchaseOrders(options?: {
    skip?: number;
    take?: number;
    filter?: string;
  }): Promise<SageApiResponse<SagePurchaseOrder>> {
    const params = new URLSearchParams();
    if (options?.skip) params.append('$skip', String(options.skip));
    if (options?.take) params.append('$top', String(options.take));
    if (options?.filter) params.append('$filter', options.filter);

    const query = params.toString();
    const endpoint = `SupplierPurchaseOrder/Get${query ? `?${query}` : ''}`;

    return this.get<SageApiResponse<SagePurchaseOrder>>(endpoint);
  }

  /**
   * Get purchase order by ID
   */
  async getPurchaseOrder(id: string): Promise<SagePurchaseOrder> {
    return this.get<SagePurchaseOrder>(`SupplierPurchaseOrder/Get/${id}`);
  }

  /**
   * Create a purchase order
   */
  async createPurchaseOrder(po: SagePurchaseOrder): Promise<SagePurchaseOrder> {
    return this.post<SagePurchaseOrder>('SupplierPurchaseOrder/Save', po);
  }

  /**
   * Update a purchase order
   */
  async updatePurchaseOrder(po: SagePurchaseOrder): Promise<SagePurchaseOrder> {
    return this.put<SagePurchaseOrder>('SupplierPurchaseOrder/Save', po);
  }

  // ==========================================================================
  // Chart of Accounts
  // ==========================================================================

  /**
   * Get all accounts (Chart of Accounts)
   */
  async getAccounts(options?: {
    skip?: number;
    take?: number;
    filter?: string;
  }): Promise<SageApiResponse<SageAccount>> {
    const params = new URLSearchParams();
    if (options?.skip) params.append('$skip', String(options.skip));
    if (options?.take) params.append('$top', String(options.take));
    if (options?.filter) params.append('$filter', options.filter);

    const query = params.toString();
    const endpoint = `Account/Get${query ? `?${query}` : ''}`;

    return this.get<SageApiResponse<SageAccount>>(endpoint);
  }

  /**
   * Get account by ID
   */
  async getAccount(id: string): Promise<SageAccount> {
    return this.get<SageAccount>(`Account/Get/${id}`);
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Test API connection
   */
  async testConnection(): Promise<{ success: boolean; message: string; companyId?: string }> {
    try {
      // Try to fetch suppliers to verify connection
      const suppliers = await this.getSuppliers({ take: 1 });

      return {
        success: true,
        message: `Connection successful. Found ${suppliers.TotalResults || 0} suppliers.`,
        companyId: this.companyId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Sage connection test failed', { error: message });

      return {
        success: false,
        message,
      };
    }
  }

  /**
   * Get API info for debugging
   */
  getApiInfo(): { baseUrl: string; apiVersion: string; companyId: string; authType: string; hasTokens: boolean } {
    return {
      baseUrl: this.baseUrl,
      apiVersion: this.apiVersion,
      companyId: this.companyId,
      authType: 'OAuth2',
      hasTokens: this.hasValidTokens(),
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create SageClient from environment variables
 */
export function createSageClient(): SageClient {
  const clientId = process.env.SAGE_CLIENT_ID;
  const clientSecret = process.env.SAGE_CLIENT_SECRET;
  const companyId = process.env.SAGE_COMPANY_ID;

  if (!clientId || !clientSecret || !companyId) {
    throw new Error(
      'SAGE_CLIENT_ID, SAGE_CLIENT_SECRET, and SAGE_COMPANY_ID environment variables required'
    );
  }

  return new SageClient({
    clientId,
    clientSecret,
    companyId,
    baseUrl: process.env.SAGE_BASE_URL,
    apiVersion: process.env.SAGE_API_VERSION,
  });
}

/**
 * Create SageClient from database config (OAuth 2.0)
 */
export function createSageClientFromConfig(config: {
  clientId: string;
  clientSecret: string;
  companyId: string;
  baseUrl?: string;
  apiVersion?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
}): SageClient {
  if (!config.clientId) {
    throw new Error('Client ID is required');
  }

  if (!config.clientSecret) {
    throw new Error('Client Secret is required');
  }

  const client = new SageClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    companyId: config.companyId,
    baseUrl: config.baseUrl,
    apiVersion: config.apiVersion,
    accessToken: config.accessToken,
    refreshToken: config.refreshToken,
    expiresAt: config.expiresAt,
  });

  return client;
}
