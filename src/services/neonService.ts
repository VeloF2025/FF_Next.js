// Browser environment - use API wrapper
// This file now redirects all database operations through API endpoints

// Import the API wrapper instead of direct database connection
import { neonService as apiService, sowQueries as apiSowQueries } from './neonServiceAPI';

// Re-export the API service as neonService to maintain compatibility
export const neonService = apiService;
export const sowQueries = apiSowQueries;

// Export NeonQueryResult type from the API module
export type { NeonQueryResult } from './neonServiceAPI';