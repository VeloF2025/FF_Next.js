import type { NextApiRequest, NextApiResponse } from 'next';
import type { RFQ } from '../../../../src/types/procurement/rfq.types';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql, logCreate, logUpdate, logDelete } from '@/lib/db-logger';
import { apiResponse, ErrorCode } from '../../../../src/lib/apiResponse';

// Initialize database connection with logging
const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const { projectId } = req.query;

  if (req.method === 'GET') {
    try {
      // Query real data from database
      let rfqData: any[];
      let itemsData: any[] = [];
      let suppliersData: any[] = [];

      if (projectId && projectId !== 'all') {
        // Get RFQs for specific project
        rfqData = await sql`
          SELECT * FROM rfqs
          WHERE project_id = ${projectId}
          ORDER BY created_at DESC
        `;

        // Get RFQ items
        if (rfqData.length > 0) {
          const rfqIds = rfqData.map(r => r.id);
          itemsData = await sql`
            SELECT * FROM rfq_items
            WHERE rfq_id = ANY(${rfqIds})
            ORDER BY line_number
          `;

          // Get suppliers from junction table
          suppliersData = await sql`
            SELECT rs.*, s.company_name, s.name, s.email
            FROM rfq_suppliers rs
            JOIN suppliers s ON rs.supplier_id = s.id
            WHERE rs.rfq_id = ANY(${rfqIds})
          `;
        } else {
          itemsData = [];
        }
      } else {
        // Get all RFQs with quotes count
        rfqData = await sql`
          SELECT
            r.*,
            (SELECT COUNT(*) FROM quotes WHERE quotes.rfq_id = r.id)::int as quotes_received
          FROM rfqs r
          ORDER BY r.created_at DESC
          LIMIT 100
        `;

        // Get items for recent RFQs
        if (rfqData.length > 0) {
          const rfqIds = rfqData.slice(0, 20).map(r => r.id);
          itemsData = await sql`
            SELECT * FROM rfq_items
            WHERE rfq_id = ANY(${rfqIds})
            ORDER BY line_number
            LIMIT 200
          `;

          // Get suppliers from junction table
          suppliersData = await sql`
            SELECT rs.*, s.company_name, s.name, s.email
            FROM rfq_suppliers rs
            JOIN suppliers s ON rs.supplier_id = s.id
            WHERE rs.rfq_id = ANY(${rfqIds})
          `;
        } else {
          itemsData = [];
        }
      }

      // Group suppliers by RFQ
      const suppliersByRfq = suppliersData.reduce((acc, sup) => {
        if (!acc[sup.rfq_id]) acc[sup.rfq_id] = [];
        acc[sup.rfq_id].push({
          id: sup.supplier_id,
          name: sup.company_name || sup.name,
          email: sup.email,
          status: sup.status,
          invitedAt: sup.invited_at,
          respondedAt: sup.responded_at
        });
        return acc;
      }, {} as Record<string, any[]>);
      
      // Group items by RFQ
      const itemsByRfq = itemsData.reduce((acc, item) => {
        if (!acc[item.rfq_id]) acc[item.rfq_id] = [];
        acc[item.rfq_id].push(item);
        return acc;
      }, {} as Record<string, typeof itemsData>);
      
      // Transform data to match expected format
      const transformedRFQs = rfqData.map((rfq: any) => ({
        id: rfq.id,
        rfqNumber: rfq.rfq_number,
        projectId: rfq.project_id,
        title: rfq.title,
        description: rfq.description || '',
        status: rfq.status as 'draft' | 'open' | 'evaluating' | 'awarded' | 'cancelled',
        createdDate: rfq.created_at || new Date().toISOString(),
        dueDate: rfq.response_deadline || new Date().toISOString(),
        items: (itemsByRfq[rfq.id] || []).map((item: any) => ({
          id: item.id,
          description: item.description,
          quantity: Number(item.quantity),
          unit: item.uom,
          specifications: typeof item.specifications === 'string'
            ? item.specifications
            : JSON.stringify(item.specifications || '')
        })),
        suppliers: suppliersByRfq[rfq.id] || [],
        quotesReceived: rfq.quotes_received || 0,
        totalValue: rfq.total_budget_estimate ? Number(rfq.total_budget_estimate) : 0,
        createdBy: rfq.created_by || 'System',
        updatedAt: rfq.updated_at || new Date().toISOString()
      }));
      
      // Add aggregated stats
      const stats = {
        totalRFQs: transformedRFQs.length,
        openRFQs: transformedRFQs.filter(r => r.status === 'open').length,
        totalValue: transformedRFQs.reduce((sum, rfq) => sum + rfq.totalValue, 0),
        avgQuotesPerRFQ: transformedRFQs.length > 0 
          ? transformedRFQs.reduce((sum, rfq) => sum + rfq.quotesReceived, 0) / transformedRFQs.length 
          : 0,
      };

      // Check if we should use paginated response
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 100;
      
      if (req.query.page || req.query.limit) {
        // Return paginated response
        return apiResponse.paginated(
          res,
          transformedRFQs,
          {
            page,
            pageSize: limit,
            total: transformedRFQs.length,
          },
          undefined,
          { stats }
        );
      } else {
        // Return standard response with stats in meta
        return apiResponse.success(
          res,
          {
            rfqs: transformedRFQs,
            total: transformedRFQs.length,
          },
          undefined,
          200,
          { stats }
        );
      }
    } catch (error) {
      return apiResponse.databaseError(res, error, 'Failed to fetch RFQs');
    }
  } else if (req.method === 'POST') {
    try {
      const newRFQ = req.body;
      
      // Validate required fields
      const validationErrors: Record<string, string> = {};
      
      if (!newRFQ.title) {
        validationErrors.title = 'RFQ title is required';
      }
      
      if (!newRFQ.projectId && !projectId) {
        validationErrors.projectId = 'Project ID is required';
      }
      
      if (newRFQ.items && !Array.isArray(newRFQ.items)) {
        validationErrors.items = 'Items must be an array';
      }
      
      if (newRFQ.status && !['draft', 'open', 'evaluating', 'awarded', 'cancelled'].includes(newRFQ.status)) {
        validationErrors.status = 'Invalid RFQ status';
      }
      
      // Return validation errors if any
      if (Object.keys(validationErrors).length > 0) {
        return apiResponse.validationError(res, validationErrors);
      }
      
      // Generate RFQ number if not provided
      const rfqNumber = newRFQ.rfqNumber || `RFQ-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
      const responseDeadline = newRFQ.responseDeadline || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      
      // Insert new RFQ into database (no longer storing invited_suppliers JSON)
      const insertedRFQs = await sql`
        INSERT INTO rfqs (
          rfq_number, project_id, title, description, status,
          response_deadline, total_budget_estimate, created_by
        )
        VALUES (
          ${rfqNumber},
          ${newRFQ.projectId || projectId},
          ${newRFQ.title},
          ${newRFQ.description || ''},
          ${newRFQ.status || 'draft'},
          ${responseDeadline},
          ${newRFQ.totalValue || 0},
          ${newRFQ.createdBy || 'System'}
        )
        RETURNING *
      `;

      const rfqId = insertedRFQs[0].id;

      // Insert suppliers into junction table
      const supplierIds = newRFQ.suppliers || newRFQ.supplierIds || [];
      const insertedSuppliers: any[] = [];
      for (const supplierId of supplierIds) {
        if (supplierId) {
          try {
            const result = await sql`
              INSERT INTO rfq_suppliers (rfq_id, supplier_id, status)
              VALUES (${rfqId}, ${parseInt(supplierId)}, 'invited')
              ON CONFLICT (rfq_id, supplier_id) DO NOTHING
              RETURNING *
            `;
            if (result[0]) {
              insertedSuppliers.push(result[0]);
            }
          } catch (e) {
            // Skip invalid supplier IDs
          }
        }
      }

      // Insert items if provided
      const items = newRFQ.items || [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await sql`
          INSERT INTO rfq_items (
            rfq_id, line_number, description, quantity, uom,
            specifications, estimated_unit_price, stock_item_id, boq_item_id
          ) VALUES (
            ${rfqId}, ${i + 1}, ${item.description}, ${item.quantity}, ${item.unit || item.uom || 'EA'},
            ${item.specifications || null}, ${item.estimatedUnitPrice || item.estimated_unit_price || 0},
            ${item.stockItemId || item.stock_item_id || null},
            ${item.boqItemId || item.boq_item_id || null}
          )
        `;
      }

      // Create boq_rfq_links record if items were imported from BOQ
      const sourceBoqId = newRFQ.sourceBoqId;
      const boqLinkedItemsCount = items.filter((i: any) => i.boqItemId).length;
      if (sourceBoqId && boqLinkedItemsCount > 0) {
        try {
          await sql`
            INSERT INTO boq_rfq_links (boq_id, rfq_id, link_type, linked_items_count, created_by)
            VALUES (${sourceBoqId}, ${rfqId}, 'import', ${boqLinkedItemsCount}, ${newRFQ.createdBy || 'System'})
            ON CONFLICT DO NOTHING
          `;
        } catch (e) {
          // Non-critical - don't fail if link creation fails
        }
      }

      // Log RFQ creation
      logCreate('rfq', rfqId, {
        rfq_number: insertedRFQs[0].rfq_number,
        project_id: insertedRFQs[0].project_id,
        title: insertedRFQs[0].title,
        total_budget: insertedRFQs[0].total_budget_estimate,
        suppliers_count: insertedSuppliers.length,
        items_count: items.length,
        source_boq_id: sourceBoqId || null
      });

      // Get supplier details for response
      let supplierDetails: any[] = [];
      if (insertedSuppliers.length > 0) {
        const sIds = insertedSuppliers.map(s => s.supplier_id);
        supplierDetails = await sql`
          SELECT id, company_name, name, email FROM suppliers WHERE id = ANY(${sIds})
        `;
      }

      // Transform the response to match RFQ type
      const createdRFQ: RFQ = {
        id: rfqId,
        rfqNumber: insertedRFQs[0].rfq_number,
        projectId: insertedRFQs[0].project_id,
        title: insertedRFQs[0].title,
        description: insertedRFQs[0].description || '',
        status: insertedRFQs[0].status as 'draft' | 'open' | 'evaluating' | 'awarded' | 'cancelled',
        createdDate: insertedRFQs[0].created_at || new Date().toISOString(),
        dueDate: insertedRFQs[0].response_deadline || new Date().toISOString(),
        items: items.map((item: any, idx: number) => ({
          id: `temp-${idx}`,
          description: item.description,
          quantity: Number(item.quantity),
          unit: item.unit || item.uom || 'EA',
          specifications: item.specifications || ''
        })),
        suppliers: supplierDetails.map((s: any) => ({
          id: s.id,
          name: s.company_name || s.name,
          email: s.email
        })),
        quotesReceived: 0,
        totalValue: Number(insertedRFQs[0].total_budget_estimate || 0),
        createdBy: insertedRFQs[0].created_by || 'System',
        updatedAt: insertedRFQs[0].updated_at || new Date().toISOString()
      };
      
      return apiResponse.created(res, createdRFQ, 'RFQ created successfully');
    } catch (error: any) {
      // Check for specific database errors
      if (error.code === '23505') { // Unique constraint violation
        return apiResponse.error(
          res,
          ErrorCode.CONFLICT,
          'An RFQ with this number already exists'
        );
      }
      
      if (error.code === '23503') { // Foreign key violation
        return apiResponse.error(
          res,
          ErrorCode.VALIDATION_ERROR,
          'Invalid project ID or related reference'
        );
      }
      
      return apiResponse.databaseError(res, error, 'Failed to create RFQ');
    }
  } else {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
  }
})