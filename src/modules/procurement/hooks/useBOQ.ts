import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { boqService } from '@/services/procurement/boqService';
import { BOQFormData, BOQStatus } from '@/types/procurement.types';
import type { BOQ } from '@/types/procurement/boq.types';
import { notificationService } from '@/services/core/NotificationService';

// Get all BOQs
export function useBOQs(filter?: { projectId?: string; clientId?: string; status?: BOQStatus }) {
  return useQuery({
    queryKey: ['boqs', filter],
    queryFn: () => boqService.getAll(filter),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Get single BOQ
export function useBOQ(id: string) {
  return useQuery({
    queryKey: ['boqs', id],
    queryFn: () => boqService.getById(id),
    enabled: !!id,
  });
}

// Get BOQ templates
export function useBOQTemplates() {
  return useQuery({
    queryKey: ['boq-templates'],
    queryFn: () => boqService.getTemplates(),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

// Create BOQ
export function useCreateBOQ() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: BOQFormData) => boqService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['boqs'] });
      notificationService.operationSuccess('created', 'BOQ');
    },
    onError: (error: Error) => {
      notificationService.operationError('create', error, 'BOQ');
    },
  });
}

// Update BOQ
export function useUpdateBOQ() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<BOQFormData> }) =>
      boqService.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['boqs'] });
      queryClient.invalidateQueries({ queryKey: ['boqs', variables.id] });
      notificationService.operationSuccess('updated', 'BOQ');
    },
    onError: (error: Error) => {
      notificationService.operationError('update', error, 'BOQ');
    },
  });
}

// Delete BOQ
export function useDeleteBOQ() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => boqService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['boqs'] });
      notificationService.operationSuccess('deleted', 'BOQ');
    },
    onError: (error: Error) => {
      notificationService.operationError('delete', error, 'BOQ');
    },
  });
}

// Update BOQ status
export function useUpdateBOQStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status, approvedBy }: { id: string; status: BOQStatus; approvedBy?: string }) =>
      boqService.updateStatus(id, status, approvedBy),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['boqs'] });
      queryClient.invalidateQueries({ queryKey: ['boqs', variables.id] });
      notificationService.operationSuccess('updated', 'BOQ status');
    },
    onError: (error: Error) => {
      notificationService.operationError('update', error, 'BOQ status');
    },
  });
}

// Clone BOQ
export function useCloneBOQ() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ boqId, newTitle, projectId }: { boqId: string; newTitle: string; projectId: string }) =>
      boqService.clone(boqId, newTitle, projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['boqs'] });
      notificationService.operationSuccess('cloned', 'BOQ');
    },
    onError: (error: Error) => {
      notificationService.operationError('clone', error, 'BOQ');
    },
  });
}

// Create BOQ template
export function useCreateBOQTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ boqId, templateName }: { boqId: string; templateName: string }) =>
      boqService.createTemplate(boqId, templateName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['boqs'] });
      queryClient.invalidateQueries({ queryKey: ['boq-templates'] });
      notificationService.operationSuccess('created', 'BOQ template');
    },
    onError: (error: Error) => {
      notificationService.operationError('create', error, 'BOQ template');
    },
  });
}

// Export BOQ to Excel
export function useExportBOQ() {
  return useMutation({
    mutationFn: async (boq: BOQ) => {
      const csvData = await boqService.exportToCsv(boq);
      const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${boq.boqNumber}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    },
    onSuccess: () => {
      notificationService.operationSuccess('exported', 'BOQ');
    },
    onError: (error: Error) => {
      notificationService.operationError('export', error, 'BOQ');
    },
  });
}