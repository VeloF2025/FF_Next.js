/**
 * NotesTab Component
 * 🟢 WORKING: Display and manage ticket notes with visibility control
 *
 * Features:
 * - View notes with visibility indicators (Private/Public)
 * - Filter by visibility
 * - Add new notes with visibility selection
 * - Edit and delete notes
 * - Responsive design
 *
 * Visibility:
 * - PRIVATE (default): Internal Velocity Fibre use only
 * - PUBLIC: May be synced to QContact or other external systems
 */

'use client';

import { useState } from 'react';
import {
  useTicketNotesOperations,
  CreateNotePayload,
} from '../../hooks/useTicketNotesWithMutations';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';
import { NoteCard } from './NoteCard';
import { ScreenshotAnalyzer } from './ScreenshotAnalyzer';

interface NotesTabProps {
  ticketId: string;
}

export function NotesTab({ ticketId }: NotesTabProps) {
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'private' | 'public'>('all');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteVisibility, setNewNoteVisibility] = useState<'private' | 'public'>('private');
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [_editingNoteId, _setEditingNoteId] = useState<string | null>(null);
  const [_editingContent, _setEditingContent] = useState('');

  const visibility = visibilityFilter === 'all' ? undefined : visibilityFilter;

  const {
    notes,
    summary,
    isLoading,
    isError,
    error,
    createNote,
    isCreating,
    deleteNote,
    isDeleting,
  } = useTicketNotesOperations(ticketId, visibility);

  const handleAddNote = async () => {
    if (!newNoteContent.trim()) return;

    const payload: CreateNotePayload = {
      content: newNoteContent,
      visibility: newNoteVisibility,
    };

    createNote(payload, {
      onSuccess: () => {
        setNewNoteContent('');
        setIsAddingNote(false);
      },
    });
  };

  const handleDeleteNote = (noteId: string) => {
    if (confirm('Are you sure you want to delete this note?')) {
      deleteNote(noteId);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <LoadingSpinner className="py-8" size="lg" label="Loading notes..." />
    );
  }

  if (isError) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
        <p className="text-red-600 dark:text-red-400">
          Failed to load notes: {error?.message || 'Unknown error'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with filter and add button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        {/* Visibility filter tabs */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--ff-text-secondary)]">Show:</span>
          <div className="flex rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
            <button
              onClick={() => setVisibilityFilter('all')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                visibilityFilter === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)]'
              }`}
            >
              All ({summary.total})
            </button>
            <button
              onClick={() => setVisibilityFilter('private')}
              className={`px-3 py-1.5 text-sm font-medium border-l border-[var(--ff-border-light)] transition-colors ${
                visibilityFilter === 'private'
                  ? 'bg-blue-600 text-white'
                  : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)]'
              }`}
            >
              Private ({summary.private})
            </button>
            <button
              onClick={() => setVisibilityFilter('public')}
              className={`px-3 py-1.5 text-sm font-medium border-l border-[var(--ff-border-light)] transition-colors ${
                visibilityFilter === 'public'
                  ? 'bg-blue-600 text-white'
                  : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)]'
              }`}
            >
              Public ({summary.public})
            </button>
          </div>
        </div>

        {/* Add note button */}
        {!isAddingNote && (
          <button
            onClick={() => setIsAddingNote(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 font-medium shadow-sm"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                clipRule="evenodd"
              />
            </svg>
            Add Note
          </button>
        )}
      </div>

      {/* Add note form */}
      {isAddingNote && (
        <div className="p-4 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <div className="space-y-3">
            <textarea
              value={newNoteContent}
              onChange={(e) => setNewNoteContent(e.target.value)}
              placeholder="Enter your note..."
              rows={3}
              className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent-primary)] resize-none"
              autoFocus
            />

            <div className="flex items-center justify-between">
              {/* Visibility selector */}
              <div className="flex items-center gap-3">
                <span className="text-sm text-[var(--ff-text-secondary)]">Visibility:</span>
                <div className="flex rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
                  <button
                    onClick={() => setNewNoteVisibility('private')}
                    className={`px-3 py-1.5 text-sm transition-colors flex items-center gap-1.5 ${
                      newNoteVisibility === 'private'
                        ? 'bg-amber-500 text-white'
                        : 'bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)]'
                    }`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Private
                  </button>
                  <button
                    onClick={() => setNewNoteVisibility('public')}
                    className={`px-3 py-1.5 text-sm border-l border-[var(--ff-border-light)] transition-colors flex items-center gap-1.5 ${
                      newNoteVisibility === 'public'
                        ? 'bg-green-500 text-white'
                        : 'bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)]'
                    }`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM4.332 8.027a6.012 6.012 0 011.912-2.706C6.512 5.73 6.974 6 7.5 6A1.5 1.5 0 019 7.5V8a2 2 0 004 0 2 2 0 011.523-1.943A5.977 5.977 0 0116 10c0 .34-.028.675-.083 1H15a2 2 0 00-2 2v2.197A5.973 5.973 0 0110 16v-2a2 2 0 00-2-2 2 2 0 01-2-2 2 2 0 00-1.668-1.973z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Public
                  </button>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setIsAddingNote(false);
                    setNewNoteContent('');
                  }}
                  className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] rounded-lg transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddNote}
                  disabled={!newNoteContent.trim() || isCreating}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-medium"
                >
                  {isCreating ? (
                    <>
                      <InlineSpinner size="sm" />
                      Saving...
                    </>
                  ) : (
                    'Save Note'
                  )}
                </button>
              </div>
            </div>

            {/* Visibility hint */}
            <p className="text-xs text-[var(--ff-text-tertiary)]">
              {newNoteVisibility === 'private' ? (
                <>
                  <strong>Private notes</strong> are for internal Velocity Fibre use only and will
                  never be synced to external systems.
                </>
              ) : (
                <>
                  <strong>Public notes</strong> may be synced to QContact or other external
                  systems in the future.
                </>
              )}
            </p>

            <ScreenshotAnalyzer ticketId={ticketId} visibility={newNoteVisibility} />
          </div>
        </div>
      )}

      {/* Notes list */}
      {notes.length === 0 ? (
        <div className="text-center py-8 text-[var(--ff-text-secondary)]">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-12 w-12 mx-auto mb-3 opacity-50"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p>No notes yet</p>
          <p className="text-sm mt-1">Click &quot;Add Note&quot; to create the first note for this ticket.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onDelete={() => handleDeleteNote(note.id)}
              isDeleting={isDeleting}
              formatDate={formatDate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default NotesTab;
