import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

// Valid item IDs that can be added to the main section
const VALID_ITEM_IDS = [
  'meetings',
  'action-items',
  'tasks',
  'projects',
  'maintenance',
  'analytics',
  'fleet',
  'staff',
  'contractors',
  'wa-monitor',
  'daily-progress',
];

const DEFAULT_ITEMS = ['meetings', 'action-items'];
const MAX_ITEMS = 4; // Dashboard is always pinned, plus 4 custom items

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // TODO: Replace with proper Clerk auth when ready for production
  const userId = 'dev-user-1';

  try {
    if (req.method === 'GET') {
      // Get user preferences (return defaults if doesn't exist)
      const preferences = await sql`
        SELECT * FROM user_sidebar_preferences
        WHERE user_id = ${userId}
      `;

      if (preferences.length === 0) {
        // Return defaults without creating a record
        return res.status(200).json({
          success: true,
          data: {
            user_id: userId,
            main_section_items: DEFAULT_ITEMS,
          }
        });
      }

      return res.status(200).json({
        success: true,
        data: preferences[0]
      });
    }

    if (req.method === 'PUT') {
      const { main_section_items } = req.body;

      // Validate input
      if (!Array.isArray(main_section_items)) {
        return res.status(400).json({
          success: false,
          error: 'main_section_items must be an array'
        });
      }

      // Validate max items
      if (main_section_items.length > MAX_ITEMS) {
        return res.status(400).json({
          success: false,
          error: `Maximum ${MAX_ITEMS} items allowed (plus Dashboard which is always pinned)`
        });
      }

      // Validate all item IDs
      const invalidItems = main_section_items.filter(id => !VALID_ITEM_IDS.includes(id));
      if (invalidItems.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Invalid item IDs: ${invalidItems.join(', ')}`
        });
      }

      // Remove duplicates
      const uniqueItems = [...new Set(main_section_items)];

      // Upsert preferences
      const result = await sql`
        INSERT INTO user_sidebar_preferences (user_id, main_section_items, updated_at)
        VALUES (${userId}, ${uniqueItems}, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
          main_section_items = ${uniqueItems},
          updated_at = NOW()
        RETURNING *
      `;

      return res.status(200).json({
        success: true,
        data: result[0]
      });
    }

    if (req.method === 'DELETE') {
      // Reset to defaults by deleting the record
      await sql`
        DELETE FROM user_sidebar_preferences
        WHERE user_id = ${userId}
      `;

      return res.status(200).json({
        success: true,
        data: {
          user_id: userId,
          main_section_items: DEFAULT_ITEMS,
        }
      });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('Sidebar preferences API error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}
