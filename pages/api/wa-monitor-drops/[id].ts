/**
 * WA Monitor Drop Update API
 * Update QA review drop by ID
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({
      success: false,
      error: { message: 'Invalid drop ID' }
    });
  }

  if (req.method === 'PATCH') {
    try {
      const updates = req.body;

      // Build SET clause dynamically from updates
      const setClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      // QA step fields
      const qaSteps = [
        'step_01_house_photo', 'step_02_cable_from_pole', 'step_03_cable_entry_outside',
        'step_04_cable_entry_inside', 'step_05_wall_for_installation', 'step_06_ont_back_after_install',
        'step_07_power_meter_reading', 'step_08_ont_barcode', 'step_09_ups_serial',
        'step_10_final_installation', 'step_11_green_lights', 'step_12_customer_signature'
      ];

      qaSteps.forEach(step => {
        if (updates[step] !== undefined) {
          setClauses.push(`${step} = $${paramIndex++}`);
          values.push(updates[step]);
        }
      });

      // Other fields
      if (updates.dropNumber !== undefined) {
        setClauses.push(`drop_number = $${paramIndex++}`);
        values.push(updates.dropNumber);
      }
      if (updates.comment !== undefined) {
        setClauses.push(`comment = $${paramIndex++}`);
        values.push(updates.comment);
      }
      if (updates.completed !== undefined) {
        setClauses.push(`completed = $${paramIndex++}`);
        values.push(updates.completed);
      }
      if (updates.incomplete !== undefined) {
        setClauses.push(`incomplete = $${paramIndex++}`);
        values.push(updates.incomplete);
      }
      if (updates.incorrectSteps !== undefined) {
        setClauses.push(`incorrect_steps = $${paramIndex++}`);
        values.push(updates.incorrectSteps);
      }
      if (updates.incorrectComments !== undefined) {
        setClauses.push(`incorrect_comments = $${paramIndex++}`);
        values.push(JSON.stringify(updates.incorrectComments));
      }

      // Always update updated_at
      setClauses.push(`updated_at = NOW()`);

      if (setClauses.length === 1) {
        // Only updated_at, nothing to update
        return res.status(400).json({
          success: false,
          error: { message: 'No fields to update' }
        });
      }

      // Add ID as last parameter
      values.push(id);

      // Execute update query using template literal with proper parameter substitution
      const query = `
        UPDATE qa_photo_reviews
        SET ${setClauses.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      // Execute query using sql.query() for parameterized queries
      const result = await sql.query(query, values);

      const updatedDrop = Array.isArray(result) ? result[0] : result;

      return res.status(200).json({
        success: true,
        data: updatedDrop,
        message: 'Drop updated successfully'
      });

    } catch (error) {
      console.error('Error updating drop:', error);
      return res.status(500).json({
        success: false,
        error: {
          message: 'Internal server error',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  } else {
    return res.status(405).json({
      success: false,
      error: { message: 'Method not allowed' }
    });
  }
}

export default withAuth(handler);
