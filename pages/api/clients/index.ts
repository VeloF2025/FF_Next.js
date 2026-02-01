import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '../../../lib/db.mjs';
import { safeArrayQuery } from '../../../lib/safe-query';
import { apiLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { withErrorHandler } from '../../../lib/api-error-handler';

// Transform database client record to frontend Client type
function transformClient(dbClient: Record<string, unknown>) {
  if (!dbClient) return null;
  
  // Explicitly build the result object (no spread to avoid override issues)
  const result = { ...dbClient };
  
  // Map database columns to frontend type
  result.name = dbClient.name || dbClient.company_name || '';
  result.contactPerson = dbClient.contact_person || dbClient.contactPerson || '';
  result.postalCode = dbClient.postal_code || dbClient.postalCode || '';
  result.paymentTerms = dbClient.payment_terms || dbClient.paymentTerms || 'NET30';
  result.creditRating = dbClient.credit_rating || dbClient.creditRating || 'UNRATED';
  
  // Numeric fields with safe coercion
  const pCount = dbClient.project_count;
  result.totalProjects = typeof pCount === 'bigint' ? Number(pCount) : 
                         typeof pCount === 'string' ? parseInt(pCount, 10) || 0 :
                         typeof pCount === 'number' ? pCount : 0;
  
  const aCount = dbClient.active_projects;
  result.activeProjects = typeof aCount === 'bigint' ? Number(aCount) :
                          typeof aCount === 'string' ? parseInt(aCount, 10) || 0 :
                          typeof aCount === 'number' ? aCount : 0;
  
  const cCount = dbClient.completed_projects;
  result.completedProjects = typeof cCount === 'bigint' ? Number(cCount) :
                             typeof cCount === 'string' ? parseInt(cCount, 10) || 0 :
                             typeof cCount === 'number' ? cCount : 0;
  
  result.creditLimit = Number(dbClient.credit_limit ?? dbClient.creditLimit ?? 0);
  result.currentBalance = Number(dbClient.current_balance ?? dbClient.currentBalance ?? 0);
  
  return result;
}

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  // CORS headers are now handled by withErrorHandler
  
  try {
    switch (req.method) {
      case 'GET': {
        // Get all clients or single client by ID
        const { id, status, search } = req.query;
        
        if (id) {
          // Get single client with related projects
          const client = await safeArrayQuery(
            async () => sql`
              SELECT 
                c.*,
                COUNT(DISTINCT p.id) as project_count,
                COUNT(DISTINCT CASE WHEN p.status = 'active' OR p.status = 'ACTIVE' OR p.status = 'IN_PROGRESS' THEN p.id END) as active_projects,
                COUNT(DISTINCT CASE WHEN p.status = 'completed' OR p.status = 'COMPLETED' THEN p.id END) as completed_projects,
                SUM(p.budget) as total_budget,
                JSON_AGG(
                  DISTINCT JSONB_BUILD_OBJECT(
                    'id', p.id,
                    'project_name', p.project_name,
                    'status', p.status,
                    'start_date', p.start_date,
                    'end_date', p.end_date,
                    'budget', p.budget
                  )
                ) FILTER (WHERE p.id IS NOT NULL) as projects
              FROM clients c
              LEFT JOIN projects p ON p.client_id = c.id::text::uuid
              WHERE c.id = ${id as string}
              GROUP BY c.id
            `,
            { logError: true }
          );
          
          if (client.length === 0) {
            return res.status(404).json({ 
              success: false, 
              data: null, 
              message: 'Client not found' 
            });
          }
          
          res.status(200).json({ success: true, data: transformClient(client[0]) });
        } else {
          // Build query with filters (using safe parameterized queries)
          const clients = await safeArrayQuery(
            async () => {
              // Base query that we'll filter based on parameters
              if (search && status) {
                const searchTerm = `%${search}%`;
                return sql`
                  SELECT
                    c.*,
                    COUNT(DISTINCT p.id) as project_count,
                    COUNT(DISTINCT CASE WHEN p.status = 'active' THEN p.id END) as active_projects,
                    SUM(p.budget) as total_revenue
                  FROM clients c
                  LEFT JOIN projects p ON p.client_id = c.id::text::uuid
                  WHERE (
                    LOWER(c.company_name) LIKE LOWER(${searchTerm}) OR
                    LOWER(c.contact_person) LIKE LOWER(${searchTerm}) OR
                    LOWER(c.email) LIKE LOWER(${searchTerm})
                  ) AND c.status = ${status}
                  GROUP BY c.id
                  ORDER BY c.company_name ASC NULLS LAST
                `;
              } else if (search) {
                const searchTerm = `%${search}%`;
                return sql`
                  SELECT
                    c.*,
                    COUNT(DISTINCT p.id) as project_count,
                    COUNT(DISTINCT CASE WHEN p.status = 'active' THEN p.id END) as active_projects,
                    SUM(p.budget) as total_revenue
                  FROM clients c
                  LEFT JOIN projects p ON p.client_id = c.id::text::uuid
                  WHERE (
                    LOWER(c.company_name) LIKE LOWER(${searchTerm}) OR
                    LOWER(c.contact_person) LIKE LOWER(${searchTerm}) OR
                    LOWER(c.email) LIKE LOWER(${searchTerm})
                  )
                  GROUP BY c.id
                  ORDER BY c.company_name ASC NULLS LAST
                `;
              } else if (status) {
                return sql`
                  SELECT
                    c.*,
                    COUNT(DISTINCT p.id) as project_count,
                    COUNT(DISTINCT CASE WHEN p.status = 'active' THEN p.id END) as active_projects,
                    SUM(p.budget) as total_revenue
                  FROM clients c
                  LEFT JOIN projects p ON p.client_id = c.id::text::uuid
                  WHERE c.status = ${status}
                  GROUP BY c.id
                  ORDER BY c.company_name ASC NULLS LAST
                `;
              } else {
                return sql`
                  SELECT
                    c.*,
                    COUNT(DISTINCT p.id) as project_count,
                    COUNT(DISTINCT CASE WHEN p.status = 'active' THEN p.id END) as active_projects,
                    SUM(p.budget) as total_revenue
                  FROM clients c
                  LEFT JOIN projects p ON p.client_id = c.id::text::uuid
                  GROUP BY c.id
                  ORDER BY c.company_name ASC NULLS LAST
                `;
              }
            },
            { logError: true, retryCount: 2 }
          );
          
          // Map database fields to frontend Client type
          const mappedClients = (clients || []).map((client: any) => transformClient(client));

          // Return empty array if no clients, not an error
          res.status(200).json({
            success: true,
            data: mappedClients,
            message: mappedClients.length === 0 ? 'No clients found' : undefined
          });
        }
        break;
      }

      case 'POST': {
        // Create new client
        const clientData = req.body;
        const newClient = await sql`
          INSERT INTO clients (
            client_code, company_name, contact_person, email, phone,
            address, city, state, country, status
          )
          VALUES (
            ${clientData.client_code || clientData.clientCode || `CLI-${Date.now()}`},
            ${clientData.client_name || clientData.clientName || clientData.name || clientData.company_name},
            ${clientData.contact_person || clientData.contactPerson || null},
            ${clientData.email || null},
            ${clientData.phone || null},
            ${clientData.address || null},
            ${clientData.city || null},
            ${clientData.state || null},
            ${clientData.country || 'South Africa'},
            ${clientData.status || 'active'}
          )
          RETURNING *
        `;
        res.status(201).json({ success: true, data: newClient[0] });
        break;
      }

      case 'PUT': {
        // Update client
        if (!req.query.id) {
          return res.status(400).json({ success: false, error: 'Client ID required' });
        }
        const updates = req.body;
        const updatedClient = await sql`
          UPDATE clients 
          SET 
              company_name = COALESCE(${updates.client_name || updates.clientName || updates.name || updates.company_name}, company_name),
              contact_person = COALESCE(${updates.contact_person || updates.contactPerson}, contact_person),
              email = COALESCE(${updates.email}, email),
              phone = COALESCE(${updates.phone}, phone),
              address = COALESCE(${updates.address}, address),
              city = COALESCE(${updates.city}, city),
              state = COALESCE(${updates.state}, state),
              country = COALESCE(${updates.country}, country),
              status = COALESCE(${updates.status}, status),
              updated_at = NOW()
          WHERE id = ${req.query.id as string}
          RETURNING *
        `;
        
        if (updatedClient.length === 0) {
          return res.status(404).json({ 
            success: false, 
            error: 'Client not found' 
          });
        }
        
        res.status(200).json({ success: true, data: updatedClient[0] });
        break;
      }

      case 'DELETE': {
        // Delete client
        if (!req.query.id) {
          return res.status(400).json({ success: false, error: 'Client ID required' });
        }
        await sql`DELETE FROM clients WHERE id = ${req.query.id as string}`;
        res.status(200).json({ success: true, message: 'Client deleted successfully' });
        break;
      }

      default:
        res.status(405).json({ success: false, error: 'Method not allowed' });
    }
  } catch (error) {
    apiLogger.error({ error, method: req.method, path: '/api/clients' }, 'Client API request failed');
    res.status(500).json({ success: false, error: (error as Error).message });
  }
}))