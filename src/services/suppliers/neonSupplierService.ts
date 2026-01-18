/**
 * Neon Supplier Service
 * Direct PostgreSQL implementation for supplier management
 */

import { neon } from '@neondatabase/serverless';
import { 
  Supplier, 
  SupplierStatus,
  SupplierFormData,
  BusinessType,
  DocumentType,
  SupplierRating
} from '@/types/supplier/base.types';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

export class NeonSupplierService {
  /**
   * Get all suppliers with optional filtering
   */
  static async getAll(filter?: {
    status?: SupplierStatus;
    isPreferred?: boolean;
    category?: string;
    searchTerm?: string;
  }): Promise<Supplier[]> {
    try {
      let query = `
        SELECT 
          id,
          code,
          name,
          company_name AS "companyName",
          trading_name AS "tradingName",
          registration_number AS "registrationNumber",
          tax_number AS "taxNumber",
          status,
          business_type AS "businessType",
          is_active AS "isActive",
          is_preferred AS "isPreferred",
          is_verified AS "isVerified",
          email,
          phone,
          fax,
          website,
          contact_name,
          contact_title,
          contact_email,
          contact_phone,
          rating_overall AS "ratingOverall",
          rating_quality AS "ratingQuality",
          rating_delivery AS "ratingDelivery",
          rating_pricing AS "ratingPricing",
          rating_communication AS "ratingCommunication",
          rating_flexibility AS "ratingFlexibility",
          total_reviews AS "totalReviews",
          categories,
          tags,
          notes,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM suppliers
        WHERE 1=1
      `;

      const params: any[] = [];
      let paramCount = 0;

      if (filter?.status) {
        paramCount++;
        query += ` AND status = $${paramCount}`;
        params.push(filter.status);
      }

      if (filter?.isPreferred !== undefined) {
        paramCount++;
        query += ` AND is_preferred = $${paramCount}`;
        params.push(filter.isPreferred);
      }

      if (filter?.category) {
        paramCount++;
        query += ` AND $${paramCount} = ANY(categories)`;
        params.push(filter.category);
      }

      if (filter?.searchTerm) {
        paramCount++;
        query += ` AND search_vector @@ plainto_tsquery('english', $${paramCount})`;
        params.push(filter.searchTerm);
      }

      query += ` ORDER BY name ASC`;

      // Use sql.query() for parameterized queries (Neon v0.9+ requirement)
      const result = params.length > 0
        ? await sql.query(query, params)
        : await sql.query(query, []);

      return this.mapSuppliers(result);
    } catch (error) {
      log.error('Error fetching suppliers:', { data: error }, 'neonSupplier');
      throw new Error(`Failed to fetch suppliers: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get supplier by ID
   */
  static async getById(id: string): Promise<Supplier | null> {
    try {
      const result = await sql`
        SELECT 
          *,
          company_name AS "companyName",
          trading_name AS "tradingName",
          registration_number AS "registrationNumber",
          tax_number AS "taxNumber",
          business_type AS "businessType",
          is_active AS "isActive",
          is_preferred AS "isPreferred",
          is_verified AS "isVerified",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM suppliers 
        WHERE id = ${parseInt(id)}
      `;

      if (result.length === 0) {
        return null;
      }

      return this.mapSupplier(result[0]);
    } catch (error) {
      log.error(`Error fetching supplier ${id}:`, { data: error }, 'neonSupplier');
      throw new Error(`Failed to fetch supplier: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create new supplier
   */
  static async create(data: SupplierFormData, userId: string): Promise<string> {
    try {
      const code = data.code || `SUP-${Date.now()}`;
      
      const result = await sql`
        INSERT INTO suppliers (
          code,
          name,
          company_name,
          email,
          phone,
          status,
          business_type,
          contact_name,
          contact_email,
          contact_phone,
          physical_street1,
          physical_city,
          physical_state,
          physical_postal_code,
          physical_country,
          categories,
          notes,
          created_by,
          updated_by
        ) VALUES (
          ${code},
          ${data.name},
          ${data.companyName || data.name},
          ${data.email},
          ${data.phone || ''},
          ${data.status || SupplierStatus.PENDING},
          ${data.businessType || BusinessType.OTHER},
          ${data.primaryContact?.name || data.name},
          ${data.primaryContact?.email || data.email},
          ${data.primaryContact?.phone || data.phone || ''},
          ${data.addresses?.physical?.street1 || ''},
          ${data.addresses?.physical?.city || ''},
          ${data.addresses?.physical?.state || ''},
          ${data.addresses?.physical?.postalCode || ''},
          ${data.addresses?.physical?.country || 'South Africa'},
          ${data.categories || []},
          ${data.notes || ''},
          ${userId},
          ${userId}
        )
        RETURNING id
      `;

      return result[0].id.toString();
    } catch (error) {
      log.error('Error creating supplier:', { data: error }, 'neonSupplier');
      throw new Error(`Failed to create supplier: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update supplier
   */
  static async update(id: string, data: Partial<SupplierFormData>, userId: string): Promise<void> {
    try {
      const updateFields: string[] = [];
      const params: any[] = [];
      let paramCount = 0;

      // Support both camelCase and snake_case field names
      const fieldMapping: Record<string, string> = {
        name: 'name',
        companyName: 'company_name',
        company_name: 'company_name',
        tradingName: 'trading_name',
        trading_name: 'trading_name',
        email: 'email',
        phone: 'phone',
        website: 'website',
        status: 'status',
        businessType: 'business_type',
        business_type: 'business_type',
        registrationNumber: 'registration_number',
        registration_number: 'registration_number',
        taxNumber: 'tax_number',
        tax_number: 'tax_number',
        physicalAddress: 'physical_street1',
        physical_address: 'physical_street1',
        city: 'physical_city',
        province: 'physical_state',
        postalCode: 'physical_postal_code',
        postal_code: 'physical_postal_code',
        country: 'physical_country',
        contactName: 'contact_name',
        contact_name: 'contact_name',
        contactEmail: 'contact_email',
        contact_email: 'contact_email',
        contactPhone: 'contact_phone',
        contact_phone: 'contact_phone',
        contactTitle: 'contact_title',
        contact_title: 'contact_title',
        notes: 'notes'
      };

      Object.entries(data).forEach(([key, value]) => {
        if (value !== undefined && fieldMapping[key]) {
          paramCount++;
          updateFields.push(`${fieldMapping[key]} = $${paramCount}`);
          params.push(value);
        }
      });

      if (data.primaryContact) {
        if (data.primaryContact.name) {
          paramCount++;
          updateFields.push(`contact_name = $${paramCount}`);
          params.push(data.primaryContact.name);
        }
        if (data.primaryContact.email) {
          paramCount++;
          updateFields.push(`contact_email = $${paramCount}`);
          params.push(data.primaryContact.email);
        }
        if (data.primaryContact.phone) {
          paramCount++;
          updateFields.push(`contact_phone = $${paramCount}`);
          params.push(data.primaryContact.phone);
        }
      }

      if (data.categories) {
        paramCount++;
        updateFields.push(`categories = $${paramCount}`);
        params.push(data.categories);
      }

      paramCount++;
      updateFields.push(`updated_by = $${paramCount}`);
      params.push(userId);

      // updated_at uses NOW() - no parameter needed
      updateFields.push(`updated_at = NOW()`);

      paramCount++;
      params.push(parseInt(id));

      const query = `
        UPDATE suppliers
        SET ${updateFields.join(', ')}
        WHERE id = $${paramCount}
      `;

      log.info(`Supplier update query:`, { query, params, updateFields }, 'neonSupplier');
      const result = await sql.query(query, params);
      log.info(`Supplier update result:`, { result }, 'neonSupplier');
    } catch (error) {
      log.error(`Error updating supplier ${id}:`, { data: error }, 'neonSupplier');
      throw new Error(`Failed to update supplier: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check for supplier dependencies before deletion
   * Returns object with counts of related records
   */
  static async checkDependencies(id: string): Promise<{
    hasDependencies: boolean;
    purchaseOrders: number;
    rfqs: number;
    boqItems: number;
    grns: number;
    message?: string;
  }> {
    try {
      const supplierId = parseInt(id);

      // Check purchase orders (supplier_id is INTEGER)
      const poResult = await sql`
        SELECT COUNT(*)::int as count FROM purchase_orders WHERE supplier_id = ${supplierId}
      `;
      const purchaseOrders = poResult[0]?.count || 0;

      // Check RFQs via rfq_suppliers junction table (supplier_id is INTEGER in rfq_suppliers)
      let rfqs = 0;
      try {
        const rfqResult = await sql`
          SELECT COUNT(DISTINCT rfq_id)::int as count FROM rfq_suppliers WHERE supplier_id = ${supplierId}
        `;
        rfqs = rfqResult[0]?.count || 0;
      } catch {
        // Table might not exist or have different schema, ignore
      }

      // Check BOQ items (supplier_id can be UUID or null, so check carefully)
      let boqItems = 0;
      try {
        const boqResult = await sql`
          SELECT COUNT(*)::int as count FROM boq_items WHERE supplier_id::text = ${id}
        `;
        boqItems = boqResult[0]?.count || 0;
      } catch {
        // Table might not have supplier_id column, ignore
      }

      // Check Goods Receipt Notes (supplier_id is INTEGER)
      let grns = 0;
      try {
        const grnResult = await sql`
          SELECT COUNT(*)::int as count FROM goods_receipt_notes WHERE supplier_id = ${supplierId}
        `;
        grns = grnResult[0]?.count || 0;
      } catch {
        // Table might not exist, ignore
      }

      const hasDependencies = purchaseOrders > 0 || rfqs > 0 || boqItems > 0 || grns > 0;

      let message: string | undefined;
      if (hasDependencies) {
        const parts: string[] = [];
        if (purchaseOrders > 0) parts.push(`${purchaseOrders} purchase order${purchaseOrders > 1 ? 's' : ''}`);
        if (rfqs > 0) parts.push(`${rfqs} RFQ${rfqs > 1 ? 's' : ''}`);
        if (boqItems > 0) parts.push(`${boqItems} BOQ item${boqItems > 1 ? 's' : ''}`);
        if (grns > 0) parts.push(`${grns} goods receipt note${grns > 1 ? 's' : ''}`);
        message = `Cannot delete supplier. This supplier has ${parts.join(', ')} referencing it. Please deactivate the supplier instead, or remove the related records first.`;
      }

      return { hasDependencies, purchaseOrders, rfqs, boqItems, grns, message };
    } catch (error) {
      log.error(`Error checking supplier dependencies ${id}:`, { data: error }, 'neonSupplier');
      // Return safe default - assume dependencies exist to prevent accidental deletion
      return {
        hasDependencies: true,
        purchaseOrders: 0,
        rfqs: 0,
        boqItems: 0,
        grns: 0,
        message: 'Unable to verify dependencies. Please use soft delete (deactivate) instead.'
      };
    }
  }

  /**
   * Delete supplier (hard delete)
   * Checks for dependencies first and throws descriptive error if found
   */
  static async delete(id: string): Promise<void> {
    try {
      // Check for dependencies first
      const deps = await this.checkDependencies(id);

      if (deps.hasDependencies) {
        throw new Error(deps.message || 'Cannot delete supplier with existing dependencies');
      }

      await sql`DELETE FROM suppliers WHERE id = ${parseInt(id)}`;
    } catch (error) {
      log.error(`Error deleting supplier ${id}:`, { data: error }, 'neonSupplier');
      throw new Error(`Failed to delete supplier: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Soft delete supplier
   */
  static async softDelete(id: string, reason: string, userId: string): Promise<void> {
    try {
      await sql`
        UPDATE suppliers 
        SET 
          status = ${SupplierStatus.INACTIVE},
          is_active = false,
          inactive_reason = ${reason},
          inactivated_at = NOW(),
          updated_by = ${userId},
          updated_at = NOW()
        WHERE id = ${parseInt(id)}
      `;
    } catch (error) {
      log.error(`Error soft deleting supplier ${id}:`, { data: error }, 'neonSupplier');
      throw new Error(`Failed to soft delete supplier: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update supplier rating
   */
  static async updateRating(
    id: string,
    rating: {
      overall?: number;
      quality?: number;
      delivery?: number;
      pricing?: number;
      communication?: number;
      flexibility?: number;
    },
    userId: string
  ): Promise<void> {
    try {
      // First, add the rating to the ratings table
      await sql`
        INSERT INTO supplier_ratings (
          supplier_id,
          overall_rating,
          quality_rating,
          delivery_rating,
          pricing_rating,
          communication_rating,
          flexibility_rating,
          created_by
        ) VALUES (
          ${parseInt(id)},
          ${rating.overall || 0},
          ${rating.quality || null},
          ${rating.delivery || null},
          ${rating.pricing || null},
          ${rating.communication || null},
          ${rating.flexibility || null},
          ${userId}
        )
      `;

      // Then update the supplier's average ratings
      const avgResult = await sql`
        SELECT 
          AVG(overall_rating) as avg_overall,
          AVG(quality_rating) as avg_quality,
          AVG(delivery_rating) as avg_delivery,
          AVG(pricing_rating) as avg_pricing,
          AVG(communication_rating) as avg_communication,
          AVG(flexibility_rating) as avg_flexibility,
          COUNT(*) as total_reviews
        FROM supplier_ratings
        WHERE supplier_id = ${parseInt(id)}
      `;

      const avg = avgResult[0];

      await sql`
        UPDATE suppliers
        SET 
          rating_overall = ${avg.avg_overall || 0},
          rating_quality = ${avg.avg_quality || 0},
          rating_delivery = ${avg.avg_delivery || 0},
          rating_pricing = ${avg.avg_pricing || 0},
          rating_communication = ${avg.avg_communication || 0},
          rating_flexibility = ${avg.avg_flexibility || 0},
          total_reviews = ${avg.total_reviews || 0},
          last_review_date = NOW(),
          last_reviewed_by = ${userId}
        WHERE id = ${parseInt(id)}
      `;
    } catch (error) {
      log.error(`Error updating supplier rating for ${id}:`, { data: error }, 'neonSupplier');
      throw new Error(`Failed to update supplier rating: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Add compliance document
   */
  static async addComplianceDocument(
    supplierId: string,
    document: {
      type: DocumentType;
      name: string;
      url: string;
      expiryDate?: Date;
    },
    userId: string
  ): Promise<void> {
    try {
      await sql`
        INSERT INTO supplier_compliance (
          supplier_id,
          doc_type,
          doc_name,
          doc_url,
          expiry_date,
          uploaded_by
        ) VALUES (
          ${parseInt(supplierId)},
          ${document.type},
          ${document.name},
          ${document.url},
          ${document.expiryDate || null},
          ${userId}
        )
      `;

      // Update compliance status based on documents
      await this.updateComplianceStatus(supplierId);
    } catch (error) {
      log.error(`Error adding compliance document for supplier ${supplierId}:`, { data: error }, 'neonSupplier');
      throw new Error(`Failed to add compliance document: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update compliance status based on documents
   */
  static async updateComplianceStatus(supplierId: string): Promise<void> {
    try {
      // Check for required documents
      const docs = await sql`
        SELECT doc_type, status, expiry_date
        FROM supplier_compliance
        WHERE supplier_id = ${parseInt(supplierId)}
          AND status = 'approved'
          AND (expiry_date IS NULL OR expiry_date > NOW())
      `;

      const docTypes = docs.map(d => d.doc_type);
      
      const updates = {
        tax_compliant: docTypes.includes(DocumentType.TAX_CLEARANCE),
        bee_compliant: docTypes.includes(DocumentType.BEE_CERTIFICATE),
        insurance_valid: docTypes.includes(DocumentType.INSURANCE),
        documents_verified: docs.length > 0
      };

      await sql`
        UPDATE suppliers
        SET 
          tax_compliant = ${updates.tax_compliant},
          bee_compliant = ${updates.bee_compliant},
          insurance_valid = ${updates.insurance_valid},
          documents_verified = ${updates.documents_verified}
        WHERE id = ${parseInt(supplierId)}
      `;
    } catch (error) {
      log.error(`Error updating compliance status for supplier ${supplierId}:`, { data: error }, 'neonSupplier');
    }
  }

  /**
   * Add product to supplier
   */
  static async addProduct(
    supplierId: string,
    product: {
      code?: string;
      name: string;
      description?: string;
      category?: string;
      unitPrice?: number;
      minOrderQuantity?: number;
    }
  ): Promise<void> {
    try {
      await sql`
        INSERT INTO supplier_products (
          supplier_id,
          product_code,
          product_name,
          product_description,
          category,
          unit_price,
          min_order_quantity
        ) VALUES (
          ${parseInt(supplierId)},
          ${product.code || `PROD-${Date.now()}`},
          ${product.name},
          ${product.description || ''},
          ${product.category || ''},
          ${product.unitPrice || 0},
          ${product.minOrderQuantity || 1}
        )
      `;
    } catch (error) {
      log.error(`Error adding product for supplier ${supplierId}:`, { data: error }, 'neonSupplier');
      throw new Error(`Failed to add product: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get supplier statistics
   */
  static async getStatistics(): Promise<{
    total: number;
    active: number;
    pending: number;
    preferred: number;
    blacklisted: number;
  }> {
    try {
      const result = await sql`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = ${SupplierStatus.ACTIVE}) as active,
          COUNT(*) FILTER (WHERE status = ${SupplierStatus.PENDING}) as pending,
          COUNT(*) FILTER (WHERE is_preferred = true) as preferred,
          COUNT(*) FILTER (WHERE blacklisted = true) as blacklisted
        FROM suppliers
      `;

      return {
        total: parseInt(result[0].total),
        active: parseInt(result[0].active),
        pending: parseInt(result[0].pending),
        preferred: parseInt(result[0].preferred),
        blacklisted: parseInt(result[0].blacklisted)
      };
    } catch (error) {
      log.error('Error getting supplier statistics:', { data: error }, 'neonSupplier');
      throw new Error(`Failed to get statistics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Map database results to Supplier type
   */
  private static mapSupplier(row: any): Supplier {
    return {
      id: row.id.toString(),
      code: row.code,
      name: row.name,
      companyName: row.companyName || row.company_name,
      tradingName: row.tradingName || row.trading_name,
      registrationNumber: row.registrationNumber || row.registration_number,
      taxNumber: row.taxNumber || row.tax_number,
      status: row.status,
      businessType: row.businessType || row.business_type,
      isActive: row.isActive ?? row.is_active,
      isPreferred: row.isPreferred ?? row.is_preferred,
      isVerified: row.isVerified ?? row.is_verified,
      email: row.email,
      phone: row.phone,
      fax: row.fax,
      website: row.website,
      primaryContact: {
        name: row.contact_name || row.name,
        title: row.contact_title,
        email: row.contact_email || row.email,
        phone: row.contact_phone || row.phone
      },
      contact: {
        name: row.contact_name || row.name,
        email: row.contact_email || row.email,
        phone: row.contact_phone || row.phone
      },
      addresses: {
        physical: {
          street1: row.physical_street1 || '',
          street2: row.physical_street2 || '',
          city: row.physical_city || '',
          state: row.physical_state || '',
          postalCode: row.physical_postal_code || '',
          country: row.physical_country || 'South Africa'
        }
      },
      rating: {
        overall: parseFloat(row.ratingOverall || row.rating_overall || 0),
        totalReviews: parseInt(row.totalReviews || row.total_reviews || 0)
      },
      categories: row.categories || [],
      tags: row.tags || [],
      notes: row.notes,
      createdAt: row.createdAt || row.created_at,
      updatedAt: row.updatedAt || row.updated_at,
      createdBy: row.created_by || row.createdBy,
      updatedBy: row.updated_by || row.updatedBy,
      complianceStatus: {
        taxCompliant: row.tax_compliant || false,
        beeCompliant: row.bee_compliant || false,
        insuranceValid: row.insurance_valid || false,
        documentsVerified: row.documents_verified || false
      }
    };
  }

  private static mapSuppliers(rows: any[]): Supplier[] {
    return rows.map(row => this.mapSupplier(row));
  }
}