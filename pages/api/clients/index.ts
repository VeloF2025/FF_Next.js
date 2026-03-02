import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '../../../lib/db.mjs';
import { safeArrayQuery } from '../../../lib/safe-query';
import { log } from '@/lib/logger';
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
  result.paymentTerms = dbClient.payment_terms || dbClient.paymentTerms || 'net_30';
  result.creditRating = dbClient.credit_rating || dbClient.creditRating || 'unrated';
  result.category = dbClient.category || 'sme';
  result.priority = dbClient.priority || 'medium';
  result.salesRepresentativeId = dbClient.sales_representative_id || null;
  result.salesRepresentativeName = dbClient.sales_rep_name || null;
  result.accountManagerId = dbClient.account_manager_id || null;
  result.accountManagerName = dbClient.account_mgr_name || null;

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
                sr.name as sales_rep_name,
                am.name as account_mgr_name,
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
              LEFT JOIN staff sr ON sr.id = c.sales_representative_id
              LEFT JOIN staff am ON am.id = c.account_manager_id
              WHERE c.id = ${id as string}
              GROUP BY c.id, sr.name, am.name
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
                    sr.name as sales_rep_name,
                    am.name as account_mgr_name,
                    COUNT(DISTINCT p.id) as project_count,
                    COUNT(DISTINCT CASE WHEN p.status = 'active' THEN p.id END) as active_projects,
                    SUM(p.budget) as total_revenue
                  FROM clients c
                  LEFT JOIN projects p ON p.client_id = c.id::text::uuid
                  LEFT JOIN staff sr ON sr.id = c.sales_representative_id
                  LEFT JOIN staff am ON am.id = c.account_manager_id
                  WHERE (
                    LOWER(c.company_name) LIKE LOWER(${searchTerm}) OR
                    LOWER(c.contact_person) LIKE LOWER(${searchTerm}) OR
                    LOWER(c.email) LIKE LOWER(${searchTerm})
                  ) AND c.status = ${status}
                  GROUP BY c.id, sr.name, am.name
                  ORDER BY c.company_name ASC NULLS LAST
                `;
              } else if (search) {
                const searchTerm = `%${search}%`;
                return sql`
                  SELECT
                    c.*,
                    sr.name as sales_rep_name,
                    am.name as account_mgr_name,
                    COUNT(DISTINCT p.id) as project_count,
                    COUNT(DISTINCT CASE WHEN p.status = 'active' THEN p.id END) as active_projects,
                    SUM(p.budget) as total_revenue
                  FROM clients c
                  LEFT JOIN projects p ON p.client_id = c.id::text::uuid
                  LEFT JOIN staff sr ON sr.id = c.sales_representative_id
                  LEFT JOIN staff am ON am.id = c.account_manager_id
                  WHERE (
                    LOWER(c.company_name) LIKE LOWER(${searchTerm}) OR
                    LOWER(c.contact_person) LIKE LOWER(${searchTerm}) OR
                    LOWER(c.email) LIKE LOWER(${searchTerm})
                  )
                  GROUP BY c.id, sr.name, am.name
                  ORDER BY c.company_name ASC NULLS LAST
                `;
              } else if (status) {
                return sql`
                  SELECT
                    c.*,
                    sr.name as sales_rep_name,
                    am.name as account_mgr_name,
                    COUNT(DISTINCT p.id) as project_count,
                    COUNT(DISTINCT CASE WHEN p.status = 'active' THEN p.id END) as active_projects,
                    SUM(p.budget) as total_revenue
                  FROM clients c
                  LEFT JOIN projects p ON p.client_id = c.id::text::uuid
                  LEFT JOIN staff sr ON sr.id = c.sales_representative_id
                  LEFT JOIN staff am ON am.id = c.account_manager_id
                  WHERE c.status = ${status}
                  GROUP BY c.id, sr.name, am.name
                  ORDER BY c.company_name ASC NULLS LAST
                `;
              } else {
                return sql`
                  SELECT
                    c.*,
                    sr.name as sales_rep_name,
                    am.name as account_mgr_name,
                    COUNT(DISTINCT p.id) as project_count,
                    COUNT(DISTINCT CASE WHEN p.status = 'active' THEN p.id END) as active_projects,
                    SUM(p.budget) as total_revenue
                  FROM clients c
                  LEFT JOIN projects p ON p.client_id = c.id::text::uuid
                  LEFT JOIN staff sr ON sr.id = c.sales_representative_id
                  LEFT JOIN staff am ON am.id = c.account_manager_id
                  GROUP BY c.id, sr.name, am.name
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
        const addr = clientData.address;
        const street = typeof addr === 'object' && addr?.street ? addr.street : (typeof addr === 'string' ? addr : null);
        const newClient = await sql`
          INSERT INTO clients (
            company_name, contact_person, email, phone,
            address, city, state, country, postal_code, status,
            category, priority, payment_terms, credit_rating, credit_limit,
            sales_representative_id, account_manager_id
          )
          VALUES (
            ${clientData.client_name || clientData.clientName || clientData.name || clientData.company_name},
            ${clientData.contact_person || clientData.contactPerson || null},
            ${clientData.email || null},
            ${clientData.phone || null},
            ${street},
            ${clientData.city || (typeof addr === 'object' ? addr?.city : null) || null},
            ${clientData.state || (typeof addr === 'object' ? addr?.state : null) || null},
            ${clientData.country || (typeof addr === 'object' ? addr?.country : null) || 'South Africa'},
            ${clientData.postal_code || clientData.postalCode || (typeof addr === 'object' ? addr?.postalCode : null) || null},
            ${clientData.status || 'active'},
            ${clientData.category || 'sme'},
            ${clientData.priority || 'medium'},
            ${clientData.paymentTerms || clientData.payment_terms || 'net_30'},
            ${clientData.creditRating || clientData.credit_rating || 'unrated'},
            ${Number(clientData.creditLimit || clientData.credit_limit || 0)},
            ${clientData.salesRepresentativeId || clientData.sales_representative_id || null},
            ${clientData.accountManagerId || clientData.account_manager_id || null}
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
        const addrObj = updates.address;
        const addrStr = typeof addrObj === 'object' && addrObj?.street ? addrObj.street : (typeof addrObj === 'string' ? addrObj : null);
        const updatedClient = await sql`
          UPDATE clients
          SET
              company_name = COALESCE(${updates.client_name || updates.clientName || updates.name || updates.company_name || null}, company_name),
              contact_person = COALESCE(${updates.contact_person || updates.contactPerson || null}, contact_person),
              email = COALESCE(${updates.email || null}, email),
              phone = COALESCE(${updates.phone || null}, phone),
              address = COALESCE(${addrStr}, address),
              city = COALESCE(${updates.city || (typeof addrObj === 'object' ? addrObj?.city : null) || null}, city),
              state = COALESCE(${updates.state || (typeof addrObj === 'object' ? addrObj?.state : null) || null}, state),
              country = COALESCE(${updates.country || (typeof addrObj === 'object' ? addrObj?.country : null) || null}, country),
              postal_code = COALESCE(${updates.postal_code || updates.postalCode || (typeof addrObj === 'object' ? addrObj?.postalCode : null) || null}, postal_code),
              status = COALESCE(${updates.status || null}, status),
              category = COALESCE(${updates.category || null}, category),
              priority = COALESCE(${updates.priority || null}, priority),
              payment_terms = COALESCE(${updates.paymentTerms || updates.payment_terms || null}, payment_terms),
              credit_rating = COALESCE(${updates.creditRating || updates.credit_rating || null}, credit_rating),
              credit_limit = COALESCE(${updates.creditLimit != null ? Number(updates.creditLimit) : (updates.credit_limit != null ? Number(updates.credit_limit) : null)}, credit_limit),
              sales_representative_id = COALESCE(${updates.salesRepresentativeId || updates.sales_representative_id || null}, sales_representative_id),
              account_manager_id = COALESCE(${updates.accountManagerId || updates.account_manager_id || null}, account_manager_id),
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
    log.error('Client API request failed', { error, method: req.method, path: '/api/clients' }, 'ClientsAPI');
    res.status(500).json({ success: false, error: (error as Error).message });
  }
}))