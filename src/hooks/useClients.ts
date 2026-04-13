import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientService } from '@/services/clientService';
import { log } from '@/lib/logger';
import {
  ClientFormData,
  ClientFilter,
  ClientDropdownOption
} from '@/types/client.types';
import type { ClientSummary } from '@/types/client/summary.types';

// Query Keys
export const clientKeys = {
  all: ['clients'] as const,
  lists: () => [...clientKeys.all, 'list'] as const,
  list: (filter?: ClientFilter) => [...clientKeys.lists(), { filter }] as const,
  details: () => [...clientKeys.all, 'detail'] as const,
  detail: (id: string) => [...clientKeys.details(), id] as const,
  active: () => [...clientKeys.all, 'active'] as const,
  summary: () => [...clientKeys.all, 'summary'] as const,
  contactHistory: (clientId: string) => [...clientKeys.all, 'contactHistory', clientId] as const,
};

// Queries

/**
 * Hook to fetch all clients with optional filtering
 */
export function useClients(filter?: ClientFilter) {
  return useQuery({
    queryKey: clientKeys.list(filter),
    queryFn: () => clientService.getAll(filter),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch active clients for dropdowns
 */
export function useActiveClients() {
  return useQuery({
    queryKey: clientKeys.active(),
    queryFn: () => clientService.getActiveClients(),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Hook to fetch a single client by ID
 */
export function useClient(id: string) {
  return useQuery({
    queryKey: clientKeys.detail(id),
    queryFn: () => clientService.getById(id),
    enabled: !!id,
  });
}

/**
 * Hook to fetch client summary statistics
 */
export function useClientSummary() {
  return useQuery<ClientSummary>({
    queryKey: clientKeys.summary(),
    queryFn: () => clientService.getClientSummary() as Promise<ClientSummary>,
    staleTime: 15 * 60 * 1000, // 15 minutes
  });
}

/**
 * Hook to fetch contact history for a client
 */
export function useContactHistory(clientId: string) {
  return useQuery({
    queryKey: clientKeys.contactHistory(clientId),
    queryFn: () => clientService.getContactHistory(),
    enabled: !!clientId,
  });
}

// Mutations

/**
 * Hook to create a new client
 */
export function useCreateClient() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: ClientFormData) => clientService.create(data),
    onSuccess: () => {
      // Invalidate and refetch client queries
      queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
    onError: (error: Error) => {
      log.error('Failed to create client:', { data: error }, 'useClients');
      throw error;
    },
  });
}

/**
 * Hook to update a client
 */
export function useUpdateClient() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ClientFormData> }) => 
      clientService.update(id, data),
    onSuccess: (_, { id }) => {
      // Invalidate specific client and list queries
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
      queryClient.invalidateQueries({ queryKey: clientKeys.active() });
      queryClient.invalidateQueries({ queryKey: clientKeys.summary() });
    },
    onError: (error: Error) => {
      log.error('Failed to update client:', { data: error }, 'useClients');
      throw error;
    },
  });
}

/**
 * Hook to delete a client
 */
export function useDeleteClient() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => clientService.delete(id),
    onSuccess: (_, id) => {
      // Remove client from cache and invalidate lists
      queryClient.removeQueries({ queryKey: clientKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
      queryClient.invalidateQueries({ queryKey: clientKeys.active() });
      queryClient.invalidateQueries({ queryKey: clientKeys.summary() });
    },
    onError: (error: Error) => {
      log.error('Failed to delete client:', { data: error }, 'useClients');
      throw error;
    },
  });
}

/**
 * Hook to update client project metrics
 */
export function useUpdateClientMetrics() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: () => 
      clientService.updateClientMetrics(),
    onSuccess: () => {
      // Invalidate all client queries
      queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
    onError: (error: Error) => {
      log.error('Failed to update client metrics:', { data: error }, 'useClients');
      throw error;
    },
  });
}

/**
 * Hook to add contact history
 */
export function useAddContactHistory() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: () => 
      clientService.addContactHistory(),
    onSuccess: () => {
      // Invalidate all client queries
      queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
    onError: (error: Error) => {
      log.error('Failed to add contact history:', { data: error }, 'useClients');
      throw error;
    },
  });
}

// Custom Hooks for Client Filter Management

/**
 * Hook to manage client filter state
 */
export function useClientFilters() {
  const [filter, setFilter] = React.useState<ClientFilter>({});
  
  const updateFilter = (newFilter: Partial<ClientFilter>) => {
    setFilter(prev => ({ ...prev, ...newFilter }));
  };
  
  const clearFilter = () => {
    setFilter({});
  };
  
  const hasActiveFilters = Object.keys(filter).some(key => {
    const value = filter[key as keyof ClientFilter];
    return Array.isArray(value) ? value.length > 0 : !!value;
  });
  
  return {
    filter,
    updateFilter,
    clearFilter,
    hasActiveFilters,
  };
}

// Helper hook for client selection in forms
export function useClientSelection() {
  const { data: activeClients = [], isLoading } = useActiveClients();
  
  // Convert Client[] to ClientDropdownOption[] by filtering out clients without ids
  const dropdownOptions: ClientDropdownOption[] = activeClients
    .filter((client): client is typeof client & { id: string } => !!client.id)
    .map(client => ({
      id: client.id,
      name: client.name,
      contactPerson: client.contactPerson,
      email: client.email,
      phone: client.phone,
      status: client.status,
      category: client.category
    }));
  
  const getClientById = (id: string): ClientDropdownOption | undefined => {
    return dropdownOptions.find(client => client.id === id);
  };
  
  const searchClients = (searchTerm: string): ClientDropdownOption[] => {
    if (!searchTerm) return dropdownOptions;
    
    const term = searchTerm.toLowerCase();
    return dropdownOptions.filter(client =>
      client.name.toLowerCase().includes(term) ||
      client.contactPerson.toLowerCase().includes(term) ||
      client.email.toLowerCase().includes(term)
    );
  };
  
  return {
    clients: dropdownOptions,
    isLoading,
    getClientById,
    searchClients,
  };
}