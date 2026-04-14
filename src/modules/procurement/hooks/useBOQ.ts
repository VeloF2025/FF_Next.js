import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BOQCrud } from '@/services/procurement/boq/boqCrud';
import { BOQFormData } from '@/types/procurement.types';
import type { BOQ, BOQStatusType } from '@/types/procurement/boq.types';
import { notificationService } from '@/services/core/NotificationService';

// Get all BOQs
export function useBOQs(filter?: { projectId?: string; clientId?: string; status?: BOQStatusType }) {
  return useQuery({
    queryKey: ['boqs', filter],
    queryFn: () => BOQCrud.getAll(filter),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Get single BOQ
export function useBOQ(id: string) {
  return useQuery({
    queryKey: ['boqs', id],
    queryFn: () => BOQCrud.getById(id),
    enabled: !!id,
  });
}

// Get BOQ templates (approved BOQs)
export function useBOQTemplates() {
  return useQuery({
    queryKey: ['boq-templates'],
    queryFn: () => BOQCrud.getAll({ status: 'approved' }),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

// Create BOQ
export function useCreateBOQ() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: BOQFormData) => BOQCrud.create(data),
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
      BOQCrud.update(id, data),
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
    mutationFn: (id: string) => BOQCrud.delete(id),
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
    mutationFn: ({ id, status, approvedBy }: { id: string; status: BOQStatusType; approvedBy?: string }) =>
      BOQCrud.updateStatus(id, status, approvedBy),
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

// Clone BOQ (creates a duplicate with a new title)
export function useCloneBOQ() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ boqId, newTitle, projectId }: { boqId: string; newTitle: string; projectId: string }) => {
      const original = await BOQCrud.getById(boqId);
      return BOQCrud.create({
        ...original,
        name: newTitle,
        projectId,
        status: 'draft' as BOQStatusType,
      } as BOQFormData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['boqs'] });
      notificationService.operationSuccess('cloned', 'BOQ');
    },
    onError: (error: Error) => {
      notificationService.operationError('clone', error, 'BOQ');
    },
  });
}

// Create BOQ template (rename and mark as template)
export function useCreateBOQTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ boqId, templateName }: { boqId: string; templateName: string }) =>
      BOQCrud.update(boqId, { name: templateName } as Partial<BOQFormData>),
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

// Export BOQ to CSV
export function useExportBOQ() {
  return useMutation({
    mutationFn: async (boq: BOQ) => {
      const csvData = JSON.stringify(boq);
      const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${boq.name ?? boq.id}.csv`;
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
