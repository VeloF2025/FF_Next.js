import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql, logCreate } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

// API response interface for stock items
interface StockItemResponse {
  id: string;
  itemCode: string;
  name: string;
  description: string;
  category: string;
  projectId: string;
  warehouse: string;
  location: string;
  quantity: number;
  unit: string;
  minQuantity: number;
  maxQuantity: number;
  unitCost: number;
  totalValue: number;
  supplier: string;
  lastRestocked: string;
  status: 'in_stock' | 'low_stock' | 'out_of_stock';
  createdAt: string;
  updatedAt: string;
}

// Initialize database connection with logging
const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const { projectId } = req.query;

  if (req.method === 'GET') {
    try {
      // Query stock_items table (Odoo synced data)
      let movements: Record<string, unknown>[] = [];

      // Get all stock items from Odoo sync
      const stockData = await sql`
        SELECT
          id,
          item_code,
          name,
          description,
          category,
          qty_available,
          qty_reserved,
          qty_on_order,
          standard_cost,
          uom,
          min_stock_level,
          max_stock_level,
          odoo_product_id,
          odoo_synced_at,
          created_at,
          updated_at
        FROM stock_items
        ORDER BY name ASC
        LIMIT 500
      `;

      // Get recent movements with item details
      try {
        movements = await sql`
          SELECT
            sm.id,
            sm.reference_number,
            sm.movement_type,
            sm.from_location,
            sm.to_location,
            sm.status,
            sm.movement_date,
            sm.confirmed_at,
            sm.notes,
            sm.source_type,
            sm.odoo_picking_id,
            (
              SELECT COUNT(*) FROM stock_movement_items smi
              WHERE smi.stock_movement_id = sm.id
            ) as item_count,
            (
              SELECT COALESCE(SUM(smi.actual_quantity), 0) FROM stock_movement_items smi
              WHERE smi.stock_movement_id = sm.id
            ) as total_quantity
          FROM stock_movements sm
          ORDER BY sm.movement_date DESC
          LIMIT 50
        `;
      } catch (movErr) {
        log.error('Failed to fetch stock movements', { error: movErr });
        // stock_movements table might not have data yet
        movements = [];
      }

      // Helper function to determine stock status
      const getStockStatus = (qty: number, minLevel: number): 'in_stock' | 'low_stock' | 'out_of_stock' => {
        if (qty === 0) return 'out_of_stock';
        if (minLevel > 0 && qty <= minLevel) return 'low_stock';
        return 'in_stock';
      };

      // Transform data to match expected format
      const transformedItems: StockItemResponse[] = stockData.map(stock => {
        const quantity = Number(stock.qty_available || 0);
        const minQuantity = Number(stock.min_stock_level || 0);
        const unitCost = Number(stock.standard_cost || 0);

        return {
          id: stock.id,
          itemCode: stock.item_code || '',
          name: stock.name || 'Unnamed Item',
          description: stock.description || '',
          category: stock.category || 'General',
          projectId: '', // Not project-specific in Odoo
          warehouse: 'Odoo Warehouse',
          location: '',
          quantity,
          unit: stock.uom || 'EA',
          minQuantity,
          maxQuantity: Number(stock.max_stock_level || 0),
          unitCost,
          totalValue: quantity * unitCost,
          supplier: '', // Would need supplier join
          lastRestocked: stock.odoo_synced_at || stock.updated_at || new Date().toISOString(),
          status: getStockStatus(quantity, minQuantity),
          createdAt: stock.created_at || new Date().toISOString(),
          updatedAt: stock.updated_at || new Date().toISOString(),
        };
      });
      
      // Calculate stock statistics
      const lowStockItems = transformedItems.filter(item =>
        item.status === 'low_stock' ||
        (item.minQuantity > 0 && item.quantity <= item.minQuantity)
      );

      const outOfStockItems = transformedItems.filter(item =>
        item.quantity === 0 || item.status === 'out_of_stock'
      );
      
      // Add movement statistics
      const movementStats = {
        recentMovements: movements.length,
        lastMovementDate: movements[0]?.movement_date || null,
        totalMovements: movements.length,
      };

      res.status(200).json({ 
        items: transformedItems,
        total: transformedItems.length,
        lowStock: lowStockItems.length,
        outOfStock: outOfStockItems.length,
        movements: movements.slice(0, 10),
        stats: {
          totalValue: transformedItems.reduce((sum, item) => sum + (item.totalValue || 0), 0),
          categories: [...new Set(transformedItems.map(item => item.category))],
          ...movementStats,
        }
      });
    } catch (error) {
      log.error('Error fetching stock items', { error, module: 'procurement:stock' });
      return apiResponse.internalError(res, error);
    }
  } else if (req.method === 'POST') {
    try {
      const newItem = req.body;
      
      // Insert new stock position into database
      const insertedStocks = await sql`
        INSERT INTO stock_positions (
          project_id, item_code, item_name, description, category, uom,
          available_quantity, on_hand_quantity, warehouse_location, bin_location,
          reorder_level, max_stock_level, average_unit_cost, total_value, stock_status, is_active
        )
        VALUES (
          ${newItem.projectId || projectId},
          ${newItem.itemCode || ''},
          ${newItem.name},
          ${newItem.description || ''},
          ${newItem.category || 'General'},
          ${newItem.unit},
          ${newItem.quantity || 0},
          ${newItem.quantity || 0},
          ${newItem.warehouse || 'Main Warehouse'},
          ${newItem.location || ''},
          ${newItem.minQuantity || 0},
          ${newItem.maxQuantity || 0},
          ${newItem.unitCost || 0},
          ${newItem.totalValue || 0},
          ${newItem.status || 'in_stock'},
          true
        )
        RETURNING *
      `;
      
      // Log stock item creation
      if (insertedStocks[0]) {
        logCreate('stock_item', insertedStocks[0]!.id, {
          project_id: insertedStocks[0]!.project_id,
          item_code: insertedStocks[0]!.item_code,
          item_name: insertedStocks[0]!.item_name,
          quantity: insertedStocks[0]!.quantity_on_hand,
          warehouse: insertedStocks[0]!.warehouse_location
        });
      }

      return apiResponse.created(res, {
        message: 'Stock item added successfully',
        item: insertedStocks[0]
      });
    } catch (error) {
      log.error('Error adding stock item', { error, module: 'procurement:stock' });
      return apiResponse.internalError(res, error);
    }
  } else {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  }
}))