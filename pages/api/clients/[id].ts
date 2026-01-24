import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Client API Route
 * GET /api/clients/[id] - Get a single client with related projects
 * PUT /api/clients/[id] - Update a client
 * DELETE /api/clients/[id] - Delete a client
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query;

  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Client ID is required' });
    }

    switch (req.method) {
      case 'GET': {
        // Get single client with related projects and analytics
        const client = await sql`
          SELECT 
            c.*,
            COUNT(DISTINCT p.id) as project_count,
            COUNT(DISTINCT CASE WHEN p.status = 'ACTIVE' OR p.status = 'IN_PROGRESS' THEN p.id END) as active_projects,
            COUNT(DISTINCT CASE WHEN p.status = 'COMPLETED' THEN p.id END) as completed_projects,
            SUM(p.budget_allocated) as total_budget,
            SUM(p.budget_spent) as total_spent,
            JSON_AGG(
              DISTINCT JSONB_BUILD_OBJECT(
                'id', p.id,
                'name', p.name,
                'status', p.status,
                'priority', p.priority,
                'start_date', p.start_date,
                'end_date', p.end_date,
                'budget_allocated', p.budget_allocated,
                'budget_spent', p.budget_spent,
                'project_manager_id', p.project_manager_id
              ) ORDER BY p.created_at DESC
            ) FILTER (WHERE p.id IS NOT NULL) as projects
          FROM clients c
          LEFT JOIN projects p ON p.client_id = c.id
          WHERE c.id = ${id}
          GROUP BY c.id
        `;

        if (!client || client.length === 0) {
          return res.status(404).json({ 
            success: false,
            error: 'Client not found' 
          });
        }

        return res.status(200).json({ 
          success: true, 
          data: client[0] 
        });
      }

      case 'PUT': {
        const updates = req.body;
        const updatedClient = await sql`
          UPDATE clients 
          SET 
              name = ${updates.name || updates.company_name},
              email = ${updates.email},
              phone = ${updates.phone},
              address = ${updates.address},
              city = ${updates.city},
              state = ${updates.state},
              postal_code = ${updates.postal_code || updates.postalCode},
              country = ${updates.country},
              type = ${updates.type},
              status = ${updates.status},
              contact_person = ${updates.contact_person || updates.contactPerson},
              contact_email = ${updates.contact_email || updates.contactEmail},
              contact_phone = ${updates.contact_phone || updates.contactPhone},
              payment_terms = ${updates.payment_terms || updates.paymentTerms},
              metadata = ${updates.metadata},
              updated_at = NOW()
          WHERE id = ${id}
          RETURNING *
        `;

        if (!updatedClient || updatedClient.length === 0) {
          return res.status(404).json({ 
            success: false,
            error: 'Client not found' 
          });
        }

        return res.status(200).json({ 
          success: true, 
          data: updatedClient[0] 
        });
      }

      case 'DELETE': {
        // Check if client has active projects
        const activeProjects = await sql`
          SELECT COUNT(*) as count 
          FROM projects 
          WHERE client_id = ${id} 
            AND status NOT IN ('COMPLETED', 'CANCELLED')
        `;

        if (activeProjects[0]?.count > 0) {
          return res.status(400).json({ 
            success: false,
            error: 'Cannot delete client with active projects' 
          });
        }

        const deleted = await sql`
          DELETE FROM clients 
          WHERE id = ${id}
          RETURNING id
        `;

        if (!deleted || deleted.length === 0) {
          return res.status(404).json({ 
            success: false,
            error: 'Client not found' 
          });
        }

        return res.status(200).json({ 
          success: true, 
          message: 'Client deleted successfully' 
        });
      }

      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Client API error:', error);
    return res.status(500).json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error' 
    });
  }
}

export default withAuth(handler);