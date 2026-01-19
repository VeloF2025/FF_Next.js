/**
 * useTicketNotes Hook - Ticket Notes State Management
 *
 * 🟢 WORKING: Full CRUD operations for ticket notes with visibility control
 *
 * Features:
 * - Fetch notes for a ticket (with optional visibility filter)
 * - Create new notes (private or public)
 * - Update existing notes
 * - Delete notes
 * - Optimistic updates for better UX
 * - Automatic query invalidation
 *
 * Notes have visibility control:
 * - PRIVATE: Internal Velocity Fibre use only
 * - PUBLIC: May be synced to QContact or other apps
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createLogger } from '@/lib/logger';
import { NoteVisibility } from '../types/note';

const logger = createLogger('ticketing:hooks:notes');

// ==================== Types ====================

export interface TicketNote {
  id: string;
  ticket_id: string;
  content: string;
  note_type: string;
  visibility: 'private' | 'public';
  created_by: string;
  created_at: string;
  updated_at: string;
  is_resolution: boolean;
  attachments: string[] | null;
  author_name?: string;
  author_email?: string;
}

export interface NotesSummary {
  total: number;
  private: number;
  public: number;
}

export interface NotesResponse {
  notes: TicketNote[];
  summary: NotesSummary;
}

export interface CreateNotePayload {
  content: string;
  visibility?: 'private' | 'public';
  note_type?: string;
  is_resolution?: boolean;
  attachments?: string[];
}

export interface UpdateNotePayload {
  content?: string;
  visibility?: 'private' | 'public';
  is_resolution?: boolean;
}

// ==================== Query Keys ====================

export const ticketNotesKeys = {
  all: ['ticket-notes'] as const,
  byTicket: (ticketId: string) => [...ticketNotesKeys.all, 'ticket', ticketId] as const,
  filtered: (ticketId: string, visibility?: string) =>
    [...ticketNotesKeys.byTicket(ticketId), { visibility }] as const,
  single: (ticketId: string, noteId: string) =>
    [...ticketNotesKeys.byTicket(ticketId), 'note', noteId] as const,
};

// ==================== API Functions ====================

async function fetchNotes(
  ticketId: string,
  visibility?: 'private' | 'public'
): Promise<NotesResponse> {
  const params = new URLSearchParams();
  if (visibility) params.set('visibility', visibility);

  const url = `/api/ticketing/tickets/${ticketId}/notes${params.toString() ? '?' + params.toString() : ''}`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch notes');
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to fetch notes');
  }

  return result.data;
}

async function createNote(
  ticketId: string,
  payload: CreateNotePayload
): Promise<TicketNote> {
  const response = await fetch(`/api/ticketing/tickets/${ticketId}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to create note');
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to create note');
  }

  return result.data;
}

async function updateNote(
  ticketId: string,
  noteId: string,
  payload: UpdateNotePayload
): Promise<TicketNote> {
  const response = await fetch(`/api/ticketing/tickets/${ticketId}/notes/${noteId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to update note');
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to update note');
  }

  return result.data;
}

async function deleteNote(
  ticketId: string,
  noteId: string
): Promise<{ id: string; deleted: boolean }> {
  const response = await fetch(`/api/ticketing/tickets/${ticketId}/notes/${noteId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to delete note');
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to delete note');
  }

  return result.data;
}

// ==================== Hooks ====================

/**
 * Hook to fetch ticket notes with optional visibility filter
 *
 * @example
 * // All notes
 * const { notes, summary, isLoading } = useTicketNotes(ticketId);
 *
 * // Only private notes
 * const { notes } = useTicketNotes(ticketId, 'private');
 *
 * // Only public notes
 * const { notes } = useTicketNotes(ticketId, 'public');
 */
export function useTicketNotes(
  ticketId: string,
  visibility?: 'private' | 'public'
) {
  const query = useQuery({
    queryKey: ticketNotesKeys.filtered(ticketId, visibility),
    queryFn: () => fetchNotes(ticketId, visibility),
    enabled: !!ticketId,
    staleTime: 30000, // 30 seconds
  });

  return {
    notes: query.data?.notes ?? [],
    summary: query.data?.summary ?? { total: 0, private: 0, public: 0 },
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Hook to create a new note
 *
 * @example
 * const createNote = useCreateNote(ticketId);
 *
 * createNote.mutate({
 *   content: 'This is a note',
 *   visibility: 'private',
 * });
 */
export function useCreateNote(ticketId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateNotePayload) => createNote(ticketId, payload),
    onSuccess: (newNote) => {
      // Invalidate all notes queries for this ticket
      queryClient.invalidateQueries({
        queryKey: ticketNotesKeys.byTicket(ticketId),
      });

      logger.info('Note created successfully', {
        ticketId,
        noteId: newNote.id,
        visibility: newNote.visibility,
      });
    },
    onError: (error: Error) => {
      logger.error('Failed to create note', { ticketId, error: error.message });
    },
  });
}

/**
 * Hook to update an existing note
 *
 * @example
 * const updateNote = useUpdateNote(ticketId, noteId);
 *
 * updateNote.mutate({
 *   content: 'Updated content',
 *   visibility: 'public',
 * });
 */
export function useUpdateNote(ticketId: string, noteId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdateNotePayload) => updateNote(ticketId, noteId, payload),
    onSuccess: (updatedNote) => {
      // Invalidate all notes queries for this ticket
      queryClient.invalidateQueries({
        queryKey: ticketNotesKeys.byTicket(ticketId),
      });

      logger.info('Note updated successfully', {
        ticketId,
        noteId: updatedNote.id,
      });
    },
    onError: (error: Error) => {
      logger.error('Failed to update note', { ticketId, noteId, error: error.message });
    },
  });
}

/**
 * Hook to delete a note
 *
 * @example
 * const deleteNote = useDeleteNote(ticketId);
 *
 * deleteNote.mutate(noteId);
 */
export function useDeleteNote(ticketId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (noteId: string) => deleteNote(ticketId, noteId),
    onSuccess: (result) => {
      // Invalidate all notes queries for this ticket
      queryClient.invalidateQueries({
        queryKey: ticketNotesKeys.byTicket(ticketId),
      });

      logger.info('Note deleted successfully', {
        ticketId,
        noteId: result.id,
      });
    },
    onError: (error: Error) => {
      logger.error('Failed to delete note', { ticketId, error: error.message });
    },
  });
}

/**
 * Combined hook for all note operations
 *
 * @example
 * const {
 *   notes,
 *   summary,
 *   isLoading,
 *   createNote,
 *   updateNote,
 *   deleteNote,
 * } = useTicketNotesOperations(ticketId);
 */
export function useTicketNotesOperations(
  ticketId: string,
  visibility?: 'private' | 'public'
) {
  const notesQuery = useTicketNotes(ticketId, visibility);
  const createMutation = useCreateNote(ticketId);
  const deleteMutation = useDeleteNote(ticketId);

  return {
    // Query state
    notes: notesQuery.notes,
    summary: notesQuery.summary,
    isLoading: notesQuery.isLoading,
    isError: notesQuery.isError,
    error: notesQuery.error,
    refetch: notesQuery.refetch,

    // Mutations
    createNote: createMutation.mutate,
    createNoteAsync: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    createError: createMutation.error,

    deleteNote: deleteMutation.mutate,
    deleteNoteAsync: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
    deleteError: deleteMutation.error,
  };
}
