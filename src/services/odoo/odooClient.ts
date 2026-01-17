/**
 * Odoo JSON-RPC API Client
 *
 * Implements the Odoo External API using JSON-RPC 2.0 protocol
 *
 * Authentication: Username + Password (or API Key)
 * Rate Limiting: ~60 requests/minute for Odoo SaaS
 *
 * API Reference: https://www.odoo.com/documentation/17.0/developer/reference/external_api.html
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'odooClient' });

// ============================================================================
// Types
// ============================================================================

export interface OdooClientConfig {
  url: string;
  db: string;
  username: string;
  password: string; // Can be password or API key
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: {
      name: string;
      debug: string;
      message: string;
      arguments: string[];
    };
  };
}

export interface OdooPartner {
  id: number;
  name: string;
  email: string | false;
  phone: string | false;
  mobile: string | false;
  vat: string | false;
  street: string | false;
  street2: string | false;
  city: string | false;
  zip: string | false;
  country_id: [number, string] | false;
  state_id: [number, string] | false;
  supplier_rank: number;
  active: boolean;
  ref: string | false;
  comment: string | false;
}

export interface OdooPurchaseOrder {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  date_order: string;
  date_approve: string | false;
  state: string;
  amount_total: number;
  amount_tax: number;
  amount_untaxed: number;
  currency_id: [number, string] | false;
  picking_type_id: [number, string] | false;
  order_line: number[];
  origin: string | false;
  notes: string | false;
}

export interface OdooPurchaseOrderLine {
  id: number;
  order_id: [number, string];
  product_id: [number, string] | false;
  name: string;
  product_qty: number;
  product_uom_id: [number, string] | false;
  price_unit: number;
  price_subtotal: number;
  price_total: number;
  qty_received: number;
  qty_invoiced: number;
}

export interface OdooFleetVehicle {
  id: number;
  name: string;
  license_plate: string | false;
  vin_sn: string | false;
  model_id: [number, string] | false;
  brand_id: [number, string] | false;
  state_id: [number, string] | false;
  driver_id: [number, string] | false;
  odometer: number;
  odometer_unit: string;
  acquisition_date: string | false;
  first_contract_date: string | false;
  car_value: number;
  net_car_value: number;
  residual_value: number;
  active: boolean;
}

export interface OdooFleetServiceLog {
  id: number;
  vehicle_id: [number, string] | false;
  date: string;
  service_type_id: [number, string] | false;
  amount: number;
  description: string | false;
  odometer: number;
  vendor_id: [number, string] | false;
}

export interface OdooFleetOdometer {
  id: number;
  vehicle_id: [number, string] | false;
  date: string;
  value: number;
  unit: string;
}

export interface OdooStockPicking {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  picking_type_id: [number, string] | false;
  location_id: [number, string] | false;
  location_dest_id: [number, string] | false;
  scheduled_date: string;
  date_done: string | false;
  state: string;
  origin: string | false;
  move_ids_without_package: number[];
}

export interface OdooProduct {
  id: number;
  name: string;
  default_code: string | false;
  categ_id: [number, string] | false;
  type: string;
  list_price: number;
  standard_price: number;
  uom_id: [number, string] | false;
  active: boolean;
}

export interface OdooWarehouse {
  id: number;
  name: string;
  code: string;
  active: boolean;
}

export interface SearchReadOptions {
  fields?: string[];
  domain?: unknown[];
  limit?: number;
  offset?: number;
  order?: string;
}

// ============================================================================
// Odoo Client Class
// ============================================================================

export class OdooClient {
  private url: string;
  private db: string;
  private username: string;
  private password: string;
  private uid: number | null = null;
  private requestDelayMs = 1000; // 1 second between requests for SaaS rate limiting
  private lastRequestTime = 0;

  constructor(config: OdooClientConfig) {
    this.url = config.url.replace(/\/$/, ''); // Remove trailing slash
    this.db = config.db;
    this.username = config.username;
    this.password = config.password;
  }

  // ==========================================================================
  // JSON-RPC Core Methods
  // ==========================================================================

  /**
   * Make a JSON-RPC request to Odoo
   */
  private async jsonRpc<T>(
    method: string,
    params: Record<string, unknown>
  ): Promise<T> {
    // Rate limiting - ensure minimum delay between requests
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.requestDelayMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.requestDelayMs - timeSinceLastRequest)
      );
    }

    const response = await fetch(`${this.url}/jsonrpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: method,
        params: params,
      }),
    });

    this.lastRequestTime = Date.now();

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }

    const data: JsonRpcResponse<T> = await response.json();

    if (data.error) {
      const errorMsg = data.error.data?.message || data.error.message;
      logger.error('Odoo JSON-RPC error', {
        code: data.error.code,
        message: errorMsg,
      });
      throw new Error(`Odoo Error: ${errorMsg}`);
    }

    return data.result as T;
  }

  // ==========================================================================
  // Authentication
  // ==========================================================================

  /**
   * Authenticate with Odoo and get user ID
   */
  async authenticate(): Promise<number> {
    logger.debug('Authenticating with Odoo', {
      url: this.url,
      db: this.db,
      username: this.username,
    });

    const uid = await this.jsonRpc<number>('call', {
      service: 'common',
      method: 'authenticate',
      args: [this.db, this.username, this.password, {}],
    });

    if (!uid) {
      throw new Error('Authentication failed - check credentials or database name');
    }

    this.uid = uid;
    logger.info('Authenticated with Odoo', { uid });
    return uid;
  }

  /**
   * Get Odoo server version (doesn't require auth)
   */
  async getVersion(): Promise<{ server_version: string; server_version_info: number[] }> {
    return this.jsonRpc<{ server_version: string; server_version_info: number[] }>('call', {
      service: 'common',
      method: 'version',
      args: [],
    });
  }

  // ==========================================================================
  // Execute Methods
  // ==========================================================================

  /**
   * Execute a method on an Odoo model
   */
  async execute<T>(
    model: string,
    method: string,
    args: unknown[] = [],
    kwargs: Record<string, unknown> = {}
  ): Promise<T> {
    if (!this.uid) {
      await this.authenticate();
    }

    return this.jsonRpc<T>('call', {
      service: 'object',
      method: 'execute_kw',
      args: [this.db, this.uid, this.password, model, method, args, kwargs],
    });
  }

  /**
   * Search and read records from an Odoo model
   */
  async searchRead<T>(
    model: string,
    options: SearchReadOptions = {}
  ): Promise<T[]> {
    const { domain = [], fields = [], limit = 100, offset = 0, order } = options;

    return this.execute<T[]>(model, 'search_read', [domain], {
      fields,
      limit,
      offset,
      ...(order && { order }),
    });
  }

  /**
   * Count records matching a domain
   */
  async searchCount(model: string, domain: unknown[] = []): Promise<number> {
    return this.execute<number>(model, 'search_count', [domain]);
  }

  /**
   * Read specific records by ID
   */
  async read<T>(model: string, ids: number[], fields: string[] = []): Promise<T[]> {
    return this.execute<T[]>(model, 'read', [ids], { fields });
  }

  /**
   * Get field definitions for a model
   */
  async fieldsGet(
    model: string,
    attributes: string[] = ['string', 'type', 'required', 'readonly']
  ): Promise<Record<string, { string: string; type: string; required?: boolean; readonly?: boolean }>> {
    return this.execute<Record<string, { string: string; type: string; required?: boolean; readonly?: boolean }>>(
      model,
      'fields_get',
      [],
      { attributes }
    );
  }

  // ==========================================================================
  // Suppliers (res.partner)
  // ==========================================================================

  /**
   * Get all suppliers
   */
  async getSuppliers(options: SearchReadOptions = {}): Promise<OdooPartner[]> {
    const fields = options.fields || [
      'id', 'name', 'email', 'phone', 'vat', 'street', 'street2',
      'city', 'zip', 'country_id', 'state_id', 'supplier_rank', 'active', 'ref',
    ];

    // Get suppliers via PO history (more reliable than supplier_rank)
    const pos = await this.searchRead<{ partner_id: [number, string] | false }>(
      'purchase.order',
      { fields: ['partner_id'], limit: 500 }
    );

    const partnerIds = new Set<number>();
    for (const po of pos) {
      if (po.partner_id) {
        partnerIds.add(po.partner_id[0]);
      }
    }

    if (partnerIds.size === 0) {
      return [];
    }

    return this.searchRead<OdooPartner>('res.partner', {
      domain: [['id', 'in', Array.from(partnerIds)]],
      fields,
      limit: options.limit || 100,
    });
  }

  /**
   * Get supplier by ID
   */
  async getSupplier(id: number): Promise<OdooPartner | null> {
    const results = await this.read<OdooPartner>('res.partner', [id], [
      'id', 'name', 'email', 'phone', 'vat', 'street', 'street2',
      'city', 'zip', 'country_id', 'state_id', 'supplier_rank', 'active', 'ref', 'comment',
    ]);
    return results[0] || null;
  }

  // ==========================================================================
  // Purchase Orders
  // ==========================================================================

  /**
   * Get purchase orders
   */
  async getPurchaseOrders(options: SearchReadOptions = {}): Promise<OdooPurchaseOrder[]> {
    const fields = options.fields || [
      'id', 'name', 'partner_id', 'date_order', 'date_approve', 'state',
      'amount_total', 'amount_tax', 'amount_untaxed', 'currency_id',
      'picking_type_id', 'order_line', 'origin',
    ];

    return this.searchRead<OdooPurchaseOrder>('purchase.order', {
      ...options,
      fields,
    });
  }

  /**
   * Get purchase order by ID with line items
   */
  async getPurchaseOrder(id: number): Promise<OdooPurchaseOrder | null> {
    const results = await this.read<OdooPurchaseOrder>('purchase.order', [id], [
      'id', 'name', 'partner_id', 'date_order', 'date_approve', 'state',
      'amount_total', 'amount_tax', 'amount_untaxed', 'currency_id',
      'picking_type_id', 'order_line', 'origin',
    ]);
    return results[0] || null;
  }

  /**
   * Get purchase order line items
   */
  async getPurchaseOrderLines(lineIds: number[]): Promise<OdooPurchaseOrderLine[]> {
    return this.read<OdooPurchaseOrderLine>('purchase.order.line', lineIds, [
      'id', 'order_id', 'product_id', 'name', 'product_qty', 'product_uom_id',
      'price_unit', 'price_subtotal', 'price_total', 'qty_received', 'qty_invoiced',
    ]);
  }

  // ==========================================================================
  // Fleet
  // ==========================================================================

  /**
   * Get fleet vehicles
   */
  async getFleetVehicles(options: SearchReadOptions = {}): Promise<OdooFleetVehicle[]> {
    const fields = options.fields || [
      'id', 'name', 'license_plate', 'vin_sn', 'model_id', 'brand_id',
      'state_id', 'driver_id', 'odometer', 'odometer_unit',
      'acquisition_date', 'car_value', 'net_car_value',
      'residual_value', 'active',
    ];

    return this.searchRead<OdooFleetVehicle>('fleet.vehicle', {
      ...options,
      fields,
    });
  }

  /**
   * Get fleet service logs (fuel, maintenance, etc.)
   */
  async getFleetServiceLogs(options: SearchReadOptions = {}): Promise<OdooFleetServiceLog[]> {
    const fields = options.fields || [
      'id', 'vehicle_id', 'date', 'service_type_id', 'amount',
      'description', 'odometer', 'vendor_id',
    ];

    return this.searchRead<OdooFleetServiceLog>('fleet.vehicle.log.services', {
      ...options,
      fields,
    });
  }

  /**
   * Get fleet odometer readings
   */
  async getFleetOdometer(options: SearchReadOptions = {}): Promise<OdooFleetOdometer[]> {
    const fields = options.fields || ['id', 'vehicle_id', 'date', 'value', 'unit'];

    return this.searchRead<OdooFleetOdometer>('fleet.vehicle.odometer', {
      ...options,
      fields,
    });
  }

  // ==========================================================================
  // Stock/Inventory
  // ==========================================================================

  /**
   * Get stock transfers/pickings
   */
  async getStockPickings(options: SearchReadOptions = {}): Promise<OdooStockPicking[]> {
    const fields = options.fields || [
      'id', 'name', 'partner_id', 'picking_type_id', 'location_id',
      'location_dest_id', 'scheduled_date', 'date_done', 'state',
      'origin', 'move_ids_without_package',
    ];

    return this.searchRead<OdooStockPicking>('stock.picking', {
      ...options,
      fields,
    });
  }

  /**
   * Get warehouses
   */
  async getWarehouses(options: SearchReadOptions = {}): Promise<OdooWarehouse[]> {
    return this.searchRead<OdooWarehouse>('stock.warehouse', {
      ...options,
      fields: options.fields || ['id', 'name', 'code', 'active'],
    });
  }

  // ==========================================================================
  // Products
  // ==========================================================================

  /**
   * Get products
   */
  async getProducts(options: SearchReadOptions = {}): Promise<OdooProduct[]> {
    const fields = options.fields || [
      'id', 'name', 'default_code', 'categ_id', 'type',
      'list_price', 'standard_price', 'uom_id', 'active',
    ];

    return this.searchRead<OdooProduct>('product.product', {
      ...options,
      fields,
    });
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Test connection to Odoo
   */
  async testConnection(): Promise<{ success: boolean; message: string; version?: string }> {
    try {
      const version = await this.getVersion();
      await this.authenticate();

      return {
        success: true,
        message: `Connected to Odoo ${version.server_version}`,
        version: version.server_version,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Odoo connection test failed', { error: message });

      return {
        success: false,
        message,
      };
    }
  }

  /**
   * Get summary statistics
   */
  async getSummary(): Promise<{
    suppliers: number;
    purchaseOrders: number;
    stockPickings: number;
    fleetVehicles: number;
    products: number;
  }> {
    const [suppliers, purchaseOrders, stockPickings, fleetVehicles, products] =
      await Promise.all([
        this.searchCount('res.partner', [['supplier_rank', '>', 0]]),
        this.searchCount('purchase.order'),
        this.searchCount('stock.picking'),
        this.searchCount('fleet.vehicle'),
        this.searchCount('product.product'),
      ]);

    return {
      suppliers,
      purchaseOrders,
      stockPickings,
      fleetVehicles,
      products,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create OdooClient from environment variables
 */
export function createOdooClient(): OdooClient {
  const url = process.env.ODOO_URL;
  const db = process.env.ODOO_DB;
  const username = process.env.ODOO_USERNAME;
  const password = process.env.ODOO_PASSWORD;

  if (!url || !db || !username || !password) {
    throw new Error(
      'ODOO_URL, ODOO_DB, ODOO_USERNAME, and ODOO_PASSWORD environment variables required'
    );
  }

  return new OdooClient({ url, db, username, password });
}

/**
 * Create OdooClient from config object
 */
export function createOdooClientFromConfig(config: OdooClientConfig): OdooClient {
  if (!config.url) throw new Error('Odoo URL is required');
  if (!config.db) throw new Error('Odoo database is required');
  if (!config.username) throw new Error('Odoo username is required');
  if (!config.password) throw new Error('Odoo password is required');

  return new OdooClient(config);
}
