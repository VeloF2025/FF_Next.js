import { getSql } from '@/lib/neon-sql';
import { Client, ClientFilter, ClientSummary } from '@/types/client.types';
import { mapDbToClient, ClientDbRow } from './mappers';
import { log } from '@/lib/logger';

/**
 * Get all clients with optional filtering
 */
export async function getAllClients(filter?: ClientFilter): Promise<Client[]> {
  try {

    let result;
    
    // Base query - get all clients
    if (!filter || Object.keys(filter).length === 0) {
      result = await getSql()`
        SELECT * FROM clients
        ORDER BY name ASC
      `;
    }
    // Handle status filtering
    else if (filter.status?.length && filter.status.length > 0) {
      const statusValue = filter.status[0]; // Take first status for simplicity
      result = await getSql()`
        SELECT * FROM clients
        WHERE status = ${statusValue}
        ORDER BY name ASC
      `;
    }
    // Handle search term filtering
    else if (filter.searchTerm) {
      const searchPattern = `%${filter.searchTerm}%`;
      result = await getSql()`
        SELECT * FROM clients
        WHERE name ILIKE ${searchPattern}
          OR contact_person ILIKE ${searchPattern}
          OR email ILIKE ${searchPattern}
          OR contact_email ILIKE ${searchPattern}
        ORDER BY name ASC
      `;
    }
    // Default: return all clients
    else {
      result = await getSql()`
        SELECT * FROM clients
        ORDER BY name ASC
      `;
    }

    const rows = result as ClientDbRow[];
    return rows.map(mapDbToClient);
    
  } catch (error) {
    log.error('Error fetching clients from Neon:', { data: error }, 'queries');
    return [];
  }
}

/**
 * Get a single client by ID
 */
export async function getClientById(id: string): Promise<Client | null> {
  try {
    const result = await getSql()`
      SELECT * FROM clients
      WHERE id = ${id}
      LIMIT 1
    `;
    
    const rows = result as ClientDbRow[];
    if (!rows || rows.length === 0) {
      return null;
    }
    
    return rows[0] ? mapDbToClient(rows[0]) : null;
  } catch (error) {
    log.error('Error fetching client by ID:', { data: error }, 'queries');
    return null;
  }
}

/**
 * Get active clients for dropdowns
 */
export async function getActiveClients(): Promise<Client[]> {
  try {
    const result = await getSql()`
      SELECT * FROM clients
      WHERE status = 'ACTIVE'
      ORDER BY name ASC
    `;
    
    const rows = result as ClientDbRow[];
    return rows.map(mapDbToClient);
  } catch (error) {
    log.error('Error fetching active clients:', { data: error }, 'queries');
    return [];
  }
}

/**
 * Get client summary statistics
 */
export async function getClientSummary(): Promise<ClientSummary> {
  try {
    const result = await getSql()`
      SELECT 
        COUNT(*) as total_clients,
        COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) as active_clients,
        COUNT(CASE WHEN status = 'INACTIVE' THEN 1 END) as inactive_clients,
        COUNT(CASE WHEN metadata->>'priority' = 'HIGH' THEN 1 END) as high_priority,
        COUNT(CASE WHEN metadata->>'category' = 'PREMIUM' THEN 1 END) as premium_clients
      FROM clients
    `;
    
    const rows = result as Array<{ total_clients: string; active_clients: string; inactive_clients: string }>;
    return {
      totalClients: parseInt(rows[0]?.total_clients ?? '0'),
      activeClients: parseInt(rows[0]?.active_clients ?? '0'),
      inactiveClients: parseInt(rows[0]?.inactive_clients ?? '0'),
      prospectClients: 0,
      totalProjectValue: 0,
      averageProjectValue: 0,
      topClientsByValue: [],
      clientsByCategory: {},
      clientsByStatus: {},
      clientsByPriority: {},
      monthlyGrowth: 0,
      conversionRate: 0
    };
  } catch (error) {
    log.error('Error fetching client summary:', { data: error }, 'queries');
    return {
      totalClients: 0,
      activeClients: 0,
      inactiveClients: 0,
      prospectClients: 0,
      totalProjectValue: 0,
      averageProjectValue: 0,
      topClientsByValue: [],
      clientsByCategory: {},
      clientsByStatus: {},
      clientsByPriority: {},
      monthlyGrowth: 0,
      conversionRate: 0
    };
  }
}