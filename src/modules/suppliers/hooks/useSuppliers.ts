import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supplierService } from '@/services/suppliers/supplierService';
import {
  Supplier,
  SupplierFormData,
  SupplierStatus,
  SupplierRating,
  PerformancePeriod,
  ComplianceStatus,
  SupplierDocument,
} from '@/types/supplier.types';
import { toast } from 'react-hot-toast';

// Get all suppliers
export function useSuppliers(filter?: { 
  status?: SupplierStatus; 
  category?: string; 
  isPreferred?: boolean 
}) {
  return useQuery({
    queryKey: ['suppliers', filter],
    queryFn: () => supplierService.getAll(filter),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Get single supplier
export function useSupplier(id: string) {
  return useQuery({
    queryKey: ['suppliers', id],
    queryFn: () => supplierService.getById(id),
    enabled: !!id,
  });
}

// Get preferred suppliers
export function usePreferredSuppliers() {
  return useQuery({
    queryKey: ['suppliers', 'preferred'],
    queryFn: () => supplierService.getPreferredSuppliers(),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

// Search suppliers
export function useSearchSuppliers(searchTerm: string) {
  return useQuery({
    queryKey: ['suppliers', 'search', searchTerm],
    queryFn: () => supplierService.searchByName(searchTerm),
    enabled: searchTerm.length > 2,
    staleTime: 30 * 1000, // 30 seconds
  });
}

// Get suppliers by category
export function useSuppliersByCategory(category: string) {
  return useQuery({
    queryKey: ['suppliers', 'category', category],
    queryFn: () => supplierService.getByCategory(category),
    enabled: !!category,
  });
}

// Get supplier statistics
export function useSupplierStatistics() {
  return useQuery({
    queryKey: ['suppliers', 'statistics'],
    queryFn: () => supplierService.getStatistics(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Create supplier
export function useCreateSupplier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: SupplierFormData) => supplierService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Supplier created successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to create supplier: ${error.message}`);
    },
  });
}

// Update supplier
export function useUpdateSupplier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<SupplierFormData> }) =>
      supplierService.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers', variables.id] });
      toast.success('Supplier updated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update supplier: ${error.message}`);
    },
  });
}

// Delete supplier
export function useDeleteSupplier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => supplierService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Supplier deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete supplier: ${error.message}`);
    },
  });
}

// Update supplier status
export function useUpdateSupplierStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status, reason }: { 
      id: string; 
      status: SupplierStatus; 
      reason?: string 
    }) => supplierService.updateStatus(id, status, reason),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers', variables.id] });
      toast.success('Supplier status updated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update supplier status: ${error.message}`);
    },
  });
}

// Set preferred supplier
export function useSetPreferredSupplier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, isPreferred }: { id: string; isPreferred: boolean }) =>
      supplierService.setPreferred(id, isPreferred),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['suppliers', 'preferred'] });
      toast.success(
        variables.isPreferred 
          ? 'Supplier marked as preferred' 
          : 'Preferred status removed'
      );
    },
    onError: (error: Error) => {
      toast.error(`Failed to update preferred status: ${error.message}`);
    },
  });
}

// Update supplier rating
export function useUpdateSupplierRating() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, rating }: { id: string; rating: Partial<SupplierRating> }) =>
      supplierService.updateRating(id, rating),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers', variables.id] });
      toast.success('Supplier rating updated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update supplier rating: ${error.message}`);
    },
  });
}

// Calculate supplier performance
export function useCalculateSupplierPerformance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ supplierId, period }: { 
      supplierId: string; 
      period: PerformancePeriod 
    }) => supplierService.calculatePerformance(supplierId, period),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers', variables.supplierId] });
      toast.success('Performance calculated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to calculate performance: ${error.message}`);
    },
  });
}

// Update supplier compliance
export function useUpdateSupplierCompliance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, compliance }: { id: string; compliance: Partial<ComplianceStatus> }) =>
      supplierService.updateCompliance(id, compliance),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers', variables.id] });
      toast.success('Compliance information updated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update compliance: ${error.message}`);
    },
  });
}

// Add supplier document
export function useAddSupplierDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, document }: { id: string; document: Omit<SupplierDocument, 'id'> }) =>
      supplierService.addDocument(id, document),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['suppliers', variables.id] });
      toast.success('Document added successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to add document: ${error.message}`);
    },
  });
}

// Subscribe to supplier updates
export function useSupplierSubscription(supplierId: string, callback: (supplier: Supplier) => void) {
  const queryClient = useQueryClient();

  useQuery({
    queryKey: ['supplier-subscription', supplierId],
    queryFn: () => {
      const unsubscribe = supplierService.subscribeToSupplier(supplierId, (supplier) => {
        queryClient.setQueryData(['suppliers', supplierId], supplier);
        callback(supplier);
      });
      return unsubscribe;
    },
    enabled: !!supplierId,
  });
}