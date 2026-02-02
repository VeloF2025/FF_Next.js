/**
 * Client API Service
 * Uses API routes instead of direct database access for security
 */

const API_BASE = '/api';

interface DbClient {
  id?: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  type?: string;
  status?: string;
  contact_person?: string;
  contact_email?: string;
  contact_phone?: string;
  payment_terms?: number;
  metadata?: any;
  project_count?: number;
  active_projects?: number;
  total_revenue?: number;
  created_at?: string;
  updated_at?: string;
}

interface Client {
  id?: string;
  name: string;
  companyName: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  province?: string;
  postalCode?: string;
  country?: string;
  type?: string;
  category?: string;
  status?: string;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
  paymentTerms?: string | number;
  contractValue?: number;
  totalProjectValue?: number;
  projectCount?: number;
  activeProjects?: number;
  totalRevenue?: number;
  metadata?: any;
  created_at?: string;
  updated_at?: string;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  
  const data = await response.json();
  return data.data || data;
}

function transformDbToClient(dbClient: DbClient): any {
  return {
    id: dbClient.id,
    name: dbClient.name,
    companyName: dbClient.name, // Alias for compatibility
    email: dbClient.email,
    phone: dbClient.phone,
    address: dbClient.address,
    city: dbClient.city || 'Johannesburg',
    province: dbClient.state || 'Gauteng',
    state: dbClient.state,
    postalCode: dbClient.postal_code || '',
    country: dbClient.country || 'South Africa',
    type: dbClient.type || 'COMPANY',
    category: dbClient.type || 'SME',
    status: dbClient.status || 'ACTIVE',
    contactPerson: dbClient.contact_person,
    contactEmail: dbClient.contact_email,
    contactPhone: dbClient.contact_phone,
    paymentTerms: dbClient.payment_terms ? `NET_${dbClient.payment_terms}` : 'NET_30',
    creditLimit: 100000,
    creditRating: 'UNRATED',
    preferredContactMethod: 'EMAIL',
    communicationLanguage: 'English',
    timezone: 'Africa/Johannesburg',
    priority: 'MEDIUM',
    industry: '',
    serviceTypes: [],
    tags: [],
    projectCount: dbClient.project_count || 0,
    activeProjects: dbClient.active_projects || 0,
    totalRevenue: dbClient.total_revenue || 0,
    contractValue: dbClient.total_revenue || 0,
    totalProjectValue: dbClient.total_revenue || 0,
    metadata: dbClient.metadata || {},
    created_at: dbClient.created_at,
    updated_at: dbClient.updated_at
  };
}

function transformClientToDb(client: Partial<Client>): Partial<DbClient> {
  return {
    id: client.id,
    name: client.name || client.companyName,
    email: client.email,
    phone: client.phone,
    address: client.address,
    city: client.city,
    state: client.state || client.province,
    postal_code: client.postalCode,
    country: client.country,
    type: client.type || client.category,
    status: client.status,
    contact_person: client.contactPerson,
    contact_email: client.contactEmail,
    contact_phone: client.contactPhone,
    payment_terms: typeof client.paymentTerms === 'string' 
      ? parseInt(client.paymentTerms.replace(/\D/g, '')) || 30 
      : client.paymentTerms,
    metadata: client.metadata
  };
}

export const clientApiService = {
  async getAll(filter?: any): Promise<Client[]> {
    const params = new URLSearchParams();
    if (filter) {
      if (filter.search || filter.searchTerm) params.append('search', filter.search || filter.searchTerm);
      if (filter.status) params.append('status', filter.status);
      if (filter.type) params.append('type', filter.type);
    }
    const queryString = params.toString() ? `?${params.toString()}` : '';
    const response = await fetch(`${API_BASE}/clients${queryString}`);
    const dbClients = await handleResponse<DbClient[]>(response);
    return dbClients.map(transformDbToClient);
  },

  async getById(id: string): Promise<Client | null> {
    const response = await fetch(`${API_BASE}/clients?id=${id}`);
    const dbClient = await handleResponse<DbClient | null>(response);
    return dbClient ? transformDbToClient(dbClient) : null;
  },

  async create(clientData: any): Promise<Client> {
    // Transform the form data to match the database schema
    const dbData = transformClientToDb(clientData);
    
    const response = await fetch(`${API_BASE}/clients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dbData)
    });
    const dbClient = await handleResponse<DbClient>(response);
    return transformDbToClient(dbClient);
  },

  async update(id: string, updates: any): Promise<Client> {
    // Transform the form data to match the database schema
    const dbUpdates = transformClientToDb(updates);
    
    const response = await fetch(`${API_BASE}/clients?id=${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dbUpdates)
    });
    const dbClient = await handleResponse<DbClient>(response);
    return transformDbToClient(dbClient);
  },

  async delete(id: string): Promise<{ success: boolean; message: string }> {
    const response = await fetch(`${API_BASE}/clients?id=${id}`, {
      method: 'DELETE'
    });
    return handleResponse<{ success: boolean; message: string }>(response);
  },

  // Compatibility methods to match existing service interface
  async getActiveClients(): Promise<any[]> {
    const clients = await this.getAll();
    // Return all clients for now, regardless of status
    // Later we can filter by status when we know the exact status values
    return clients;
  },

  async getClientSummary(): Promise<{
    totalClients: number;
    activeClients: number;
    inactiveClients?: number;
    prospectClients?: number;
    totalProjects?: number;
    totalProjectValue: number;
    averageProjectValue?: number;
    topClientsByValue?: unknown[];
    clientsByCategory?: Record<string, number>;
    clientsByStatus?: Record<string, number>;
    clientsByPriority?: Record<string, number>;
    monthlyGrowth?: number;
    conversionRate?: number;
  }> {
    try {
      const response = await fetch(`${API_BASE}/clients/summary`);
      if (!response.ok) {
        throw new Error(`Failed to fetch client summary: ${response.status}`);
      }
      const result = await response.json();
      return result.data || {
        totalClients: 0,
        activeClients: 0,
        totalProjectValue: 0
      };
    } catch (error) {
      console.error('Error fetching client summary:', error);
      return {
        totalClients: 0,
        activeClients: 0,
        totalProjectValue: 0
      };
    }
  }
};