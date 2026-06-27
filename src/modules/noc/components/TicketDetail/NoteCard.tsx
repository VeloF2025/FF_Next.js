import type { TicketNote } from '../../hooks/useTicketNotesWithMutations';

interface NoteCardProps {
  note: TicketNote;
  onDelete: () => void;
  isDeleting: boolean;
  formatDate: (date: string) => string;
}

export function NoteCard({ note, onDelete, isDeleting, formatDate }: NoteCardProps) {
  const isPrivate = note.visibility === 'private';
  const isAi = note.content.startsWith('🤖');

  return (
    <div className="p-4 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Header badges */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${
                isPrivate
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'bg-green-500/20 text-green-400 border border-green-500/30'
              }`}
            >
              {isPrivate ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3 w-3"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3 w-3"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM4.332 8.027a6.012 6.012 0 011.912-2.706C6.512 5.73 6.974 6 7.5 6A1.5 1.5 0 019 7.5V8a2 2 0 004 0 2 2 0 011.523-1.943A5.977 5.977 0 0116 10c0 .34-.028.675-.083 1H15a2 2 0 00-2 2v2.197A5.973 5.973 0 0110 16v-2a2 2 0 00-2-2 2 2 0 01-2-2 2 2 0 00-1.668-1.973z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
              {isPrivate ? 'Private' : 'Public'}
            </span>

            {isAi && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                🤖 AI
              </span>
            )}

            {note.is_resolution && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400">
                Resolution
              </span>
            )}

            <span className="text-xs text-[var(--ff-text-tertiary)]">
              {formatDate(note.created_at)}
            </span>
          </div>

          {/* Content */}
          <p className="text-[var(--ff-text-primary)] whitespace-pre-wrap break-words">
            {note.content}
          </p>

          {/* Attachment thumbnails */}
          {note.attachments && note.attachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {note.attachments.map((url, i) => (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer" title="Open full size">
                  <img
                    src={url}
                    alt={`attachment ${i + 1}`}
                    className="h-24 w-24 object-cover rounded border border-[var(--ff-border-light)] hover:opacity-90"
                  />
                </a>
              ))}
            </div>
          )}

          {/* Author */}
          {note.author_name && (
            <p className="mt-2 text-xs text-[var(--ff-text-tertiary)]">
              By {note.author_name}
              {note.updated_at !== note.created_at && (
                <span className="ml-2">(edited {formatDate(note.updated_at)})</span>
              )}
            </p>
          )}
        </div>

        {/* Delete */}
        <button
          onClick={onDelete}
          disabled={isDeleting}
          className="p-1.5 text-[var(--ff-text-tertiary)] hover:text-red-400 hover:bg-red-500/20 rounded transition-colors disabled:opacity-50"
          title="Delete note"
          type="button"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default NoteCard;
