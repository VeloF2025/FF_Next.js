import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rfqService } from '@/services/procurement/rfqService';
import { RFQFormData, RFQStatus, Quote } from '@/types/procurement.types';
import { notificationService } from '@/services/core/NotificationService';

// Get all RFQs
export function useRFQs(filter?: { projectId?: string; status?: RFQStatus; supplierId?: string }) {
  return useQuery({
    queryKey: ['rfqs', filter],
    queryFn: () => rfqService.getAll(filter),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Get single RFQ
export function useRFQ(id: string) {
  return useQuery({
    queryKey: ['rfqs', id],
    queryFn: () => rfqService.getById(id),
    enabled: !!id,
  });
}

// Get RFQ responses
export function useRFQResponses(rfqId: string) {
  return useQuery({
    queryKey: ['rfq-responses', rfqId],
    queryFn: () => rfqService.getResponses(rfqId),
    enabled: !!rfqId,
  });
}

// Compare RFQ responses
export function useCompareRFQResponses(rfqId: string) {
  return useQuery({
    queryKey: ['rfq-comparison', rfqId],
    queryFn: () => rfqService.compareResponses(rfqId),
    enabled: !!rfqId,
  });
}

// Create RFQ
export function useCreateRFQ() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: RFQFormData) => rfqService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rfqs'] });
      notificationService.operationSuccess('created', 'RFQ');
    },
    onError: (error: Error) => {
      notificationService.operationError('create', error, 'RFQ');
    },
  });
}

// Update RFQ
export function useUpdateRFQ() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<RFQFormData> }) =>
      rfqService.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['rfqs'] });
      queryClient.invalidateQueries({ queryKey: ['rfqs', variables.id] });
      notificationService.operationSuccess('updated', 'RFQ');
    },
    onError: (error: Error) => {
      notificationService.operationError('update', error, 'RFQ');
    },
  });
}

// Delete RFQ
export function useDeleteRFQ() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => rfqService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rfqs'] });
      notificationService.operationSuccess('deleted', 'RFQ');
    },
    onError: (error: Error) => {
      notificationService.operationError('delete', error, 'RFQ');
    },
  });
}

// Update RFQ status
export function useUpdateRFQStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: RFQStatus }) =>
      rfqService.updateStatus(id, status),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['rfqs'] });
      queryClient.invalidateQueries({ queryKey: ['rfqs', variables.id] });
      notificationService.operationSuccess('updated', 'RFQ status');
    },
    onError: (error: Error) => {
      notificationService.operationError('update', error, 'RFQ status');
    },
  });
}

// Send RFQ to suppliers
export function useSendRFQ() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => rfqService.sendToSuppliers(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['rfqs'] });
      queryClient.invalidateQueries({ queryKey: ['rfqs', id] });
      notificationService.operationSuccess('sent', 'RFQ');
    },
    onError: (error: Error) => {
      notificationService.operationError('send', error, 'RFQ');
    },
  });
}

// Submit RFQ response
export function useSubmitRFQResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ rfqId, response }: { rfqId: string; response: Omit<Quote, 'id'> }) =>
      rfqService.submitResponse(rfqId, response),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['rfqs'] });
      queryClient.invalidateQueries({ queryKey: ['rfqs', variables.rfqId] });
      queryClient.invalidateQueries({ queryKey: ['rfq-responses', variables.rfqId] });
      notificationService.operationSuccess('submitted', 'Response');
    },
    onError: (error: Error) => {
      notificationService.operationError('submit', error, 'Response');
    },
  });
}

// Select RFQ response
export function useSelectRFQResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ rfqId, responseId, reason }: { rfqId: string; responseId: string; reason?: string }) =>
      rfqService.selectResponse(rfqId, responseId, reason),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['rfqs'] });
      queryClient.invalidateQueries({ queryKey: ['rfqs', variables.rfqId] });
      queryClient.invalidateQueries({ queryKey: ['rfq-responses', variables.rfqId] });
      notificationService.operationSuccess('selected', 'Supplier');
    },
    onError: (error: Error) => {
      notificationService.operationError('select', error, 'Supplier');
    },
  });
}

// Subscribe to RFQ updates
export function useRFQSubscription(rfqId: string, callback: (rfq: any) => void) {
  const queryClient = useQueryClient();

  useQuery({
    queryKey: ['rfq-subscription', rfqId],
    queryFn: () => {
      const unsubscribe = rfqService.subscribeToRFQ(rfqId, (rfq) => {
        queryClient.setQueryData(['rfqs', rfqId], rfq);
        callback(rfq);
      });
      return unsubscribe;
    },
    enabled: !!rfqId,
  });
}

// Subscribe to RFQ responses updates
export function useRFQResponsesSubscription(rfqId: string, callback: (responses: any[]) => void) {
  const queryClient = useQueryClient();

  useQuery({
    queryKey: ['rfq-responses-subscription', rfqId],
    queryFn: () => {
      const unsubscribe = rfqService.subscribeToResponses(rfqId, (responses) => {
        queryClient.setQueryData(['rfq-responses', rfqId], responses);
        callback(responses);
      });
      return unsubscribe;
    },
    enabled: !!rfqId,
  });
}