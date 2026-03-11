/**
 * RFQ Item Service
 * Manages RFQ line items
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { RFQItem } from '@/types/procurement.types';

const sql: any = neon(process.env.DATABASE_URL!);

export class RfqItemService {
  /**
   * Get RFQ items
   */
  static async getItems(rfqId: string): Promise<RFQItem[]> {
    try {
      const items = await sql`
        SELECT * FROM rfq_items
        WHERE rfq_id = ${rfqId}
        ORDER BY line_number`;

      return items.map((item: any) => ({
        id: item.id,
        lineNumber: item.line_number,
        itemCode: item.item_code,
        description: item.description,
        specifications: item.specifications,
        quantity: item.quantity,
        unit: item.uom,
        category: item.category,
        estimatedUnitPrice: item.estimated_unit_price,
        estimatedTotalPrice: item.estimated_total_price
      }));
    } catch (error) {
      log.error('Error fetching RFQ items:', { data: error }, 'RfqItemService');
      return [];
    }
  }

  /**
   * Add RFQ items
   */
  static async addItems(rfqId: string, items: any[]): Promise<void> {
    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await sql`
          INSERT INTO rfq_items (
            rfq_id, line_number, item_code, description,
            specifications, quantity, uom, category,
            estimated_unit_price, estimated_total_price
          ) VALUES (
            ${rfqId},
            ${i + 1},
            ${item.itemCode || ''},
            ${item.description},
            ${item.specifications || ''},
            ${item.quantity},
            ${item.unit || 'EA'},
            ${item.category || ''},
            ${item.estimatedUnitPrice || 0},
            ${item.estimatedTotalPrice || item.quantity * (item.estimatedUnitPrice || 0)}
          )`;
      }
    } catch (error) {
      log.error('Error adding RFQ items:', { data: error }, 'RfqItemService');
      throw error;
    }
  }

  /**
   * Update RFQ item
   */
  static async updateItem(itemId: string, data: Partial<RFQItem>): Promise<void> {
    try {
      const updates: string[] = [];
      const values: any[] = [];

      if (data.description !== undefined) {
        updates.push(`description = $${values.length + 1}`);
        values.push(data.description);
      }
      if (data.quantity !== undefined) {
        updates.push(`quantity = $${values.length + 1}`);
        values.push(data.quantity);
      }
      if ((data as any).estimatedUnitPrice !== undefined) {
        updates.push(`estimated_unit_price = $${values.length + 1}`);
        values.push((data as any).estimatedUnitPrice);
      }

      if (updates.length > 0) {
        values.push(itemId);
        await sql(`UPDATE rfq_items SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
      }
    } catch (error) {
      log.error('Error updating RFQ item:', { data: error }, 'RfqItemService');
      throw error;
    }
  }

  /**
   * Delete RFQ item
   */
  static async deleteItem(itemId: string): Promise<void> {
    try {
      await sql`DELETE FROM rfq_items WHERE id = ${itemId}`;
    } catch (error) {
      log.error('Error deleting RFQ item:', { data: error }, 'RfqItemService');
      throw error;
    }
  }
}
