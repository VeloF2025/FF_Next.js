import type { NextApiRequest, NextApiResponse } from 'next';
import type { BOQItem } from '../../../../src/types/procurement/boq.types';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql, logCreate, logUpdate } from '@/lib/db-logger';

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
      let boqData;
      let items;
      
      if (projectId && projectId !== 'all') {
        // Get BOQ data for specific project
        boqData = await sql`
          SELECT * FROM boqs 
          WHERE project_id = ${projectId}
          ORDER BY created_at DESC
        `;
        
        // Get BOQ items if we have BOQs
        if (boqData.length > 0) {
          items = await sql`
            SELECT * FROM boq_items 
            WHERE project_id = ${projectId}
            ORDER BY line_number
          `;
        } else {
          items = [];
        }
      } else {
        // Get all BOQs with their items count
        const boqWithCount = await sql`
          SELECT 
            b.*,
            COUNT(bi.id)::int as items_count
          FROM boqs b
          LEFT JOIN boq_items bi ON b.id = bi.boq_id
          GROUP BY b.id
          ORDER BY b.created_at DESC
          LIMIT 100
        `;
        
        boqData = boqWithCount;
        
        // Get items for all BOQs
        if (boqData.length > 0) {
          const boqIds = boqData.map(b => b.id);
          items = await sql`
            SELECT * FROM boq_items
            WHERE boq_id = ANY(${boqIds})
            ORDER BY line_number
            LIMIT 500
          `;
        } else {
          items = [];
        }
      }
      
      // Transform data to match expected format
      const transformedItems: BOQItem[] = items.map(item => ({
        id: item.id,
        projectId: item.project_id,
        itemCode: item.item_code || '',
        description: item.description,
        unit: item.uom,
        quantity: Number(item.quantity),
        unitPrice: item.unit_price ? Number(item.unit_price) : 0,
        totalPrice: item.total_price ? Number(item.total_price) : 0,
        category: item.category || 'Materials',
        supplier: item.catalog_item_name || '',
        status: item.procurement_status || 'pending',
        createdAt: item.created_at || new Date().toISOString(),
        updatedAt: item.updated_at || new Date().toISOString(),
      }));
      
      // Add aggregated stats
      const stats = {
        totalValue: transformedItems.reduce((sum, item) => sum + item.totalPrice, 0),
        totalItems: transformedItems.length,
        boqCount: boqData.length,
        categories: [...new Set(transformedItems.map(item => item.category))],
      };

      res.status(200).json({ 
        items: transformedItems,
        total: transformedItems.length,
        boqs: boqData,
        stats
      });
    } catch (error) {
      console.error('Error fetching BOQ items:', error);
      res.status(500).json({ error: 'Failed to fetch BOQ items' });
    }
  } else if (req.method === 'POST') {
    try {
      const body = req.body;
      const effectiveProjectId = body.projectId || projectId;

      if (!effectiveProjectId) {
        return res.status(400).json({ error: 'Project ID is required' });
      }

      // If items array is provided, create a full BOQ with items
      if (body.items && Array.isArray(body.items)) {
        // Generate version string
        const version = `V${Date.now()}`;

        // Calculate totals
        const totalValue = body.items.reduce((sum: number, item: BOQItem) => {
          return sum + (Number(item.totalPrice) || (Number(item.quantity) * Number(item.unitPrice)) || 0);
        }, 0);

        // First create the parent BOQ record
        const [boq] = await sql`
          INSERT INTO boqs (
            project_id, version, title, description, status,
            uploaded_by, item_count, total_estimated_value
          )
          VALUES (
            ${effectiveProjectId},
            ${version},
            ${body.title || 'Untitled BOQ'},
            ${body.description || null},
            'draft',
            ${'system'},
            ${body.items.length},
            ${totalValue}
          )
          RETURNING *
        `;

        // Log BOQ creation
        logCreate('boq', boq.id, {
          project_id: boq.project_id,
          title: boq.title,
          item_count: body.items.length,
          total_value: totalValue
        });

        // Now insert all items with the boq_id
        const insertedItems = [];
        for (let i = 0; i < body.items.length; i++) {
          const item = body.items[i];
          const itemTotal = Number(item.totalPrice) || (Number(item.quantity) * Number(item.unitPrice)) || 0;

          const [insertedItem] = await sql`
            INSERT INTO boq_items (
              boq_id, project_id, item_code, description, uom, quantity,
              unit_price, total_price, category, line_number
            )
            VALUES (
              ${boq.id},
              ${effectiveProjectId},
              ${item.itemCode || `ITEM-${i + 1}`},
              ${item.description},
              ${item.unit || item.uom || 'unit'},
              ${item.quantity},
              ${item.unitPrice || 0},
              ${itemTotal},
              ${item.category || 'Materials'},
              ${i + 1}
            )
            RETURNING *
          `;
          insertedItems.push(insertedItem);
        }

        return res.status(201).json({
          message: 'BOQ created successfully',
          boqId: boq.id,
          boq: boq,
          items: insertedItems,
          itemsCreated: insertedItems.length
        });
      }

      // Single item creation (legacy support) - requires existing boqId
      const newItem = body;
      if (!newItem.boqId) {
        return res.status(400).json({
          error: 'boqId is required for single item creation. Use items array to create a new BOQ with items.'
        });
      }

      const [insertedItem] = await sql`
        INSERT INTO boq_items (
          boq_id, project_id, item_code, description, uom, quantity,
          unit_price, total_price, category, line_number
        )
        VALUES (
          ${newItem.boqId},
          ${effectiveProjectId},
          ${newItem.itemCode || ''},
          ${newItem.description},
          ${newItem.unit || newItem.uom || 'unit'},
          ${newItem.quantity || 0},
          ${newItem.unitPrice || 0},
          ${newItem.totalPrice || 0},
          ${newItem.category || 'Materials'},
          ${newItem.sequenceNumber || 1}
        )
        RETURNING *
      `;

      // Log BOQ item creation
      logCreate('boq_item', insertedItem.id, {
        boq_id: insertedItem.boq_id,
        item_code: insertedItem.item_code,
        description: insertedItem.description,
        quantity: insertedItem.quantity,
        total_price: insertedItem.total_price
      });

      res.status(201).json({
        message: 'BOQ item created successfully',
        item: insertedItem
      });
    } catch (error) {
      console.error('Error creating BOQ:', error);
      res.status(500).json({ error: 'Failed to create BOQ' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
})