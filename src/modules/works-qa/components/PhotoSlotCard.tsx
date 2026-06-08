import { useState } from 'react';
import { Droppable, Draggable } from '@hello-pangea/dnd';
import { X, GripVertical } from 'lucide-react';
import { log } from '@/lib/logger';
import type { VlmSlotResult, SlotApproval } from '../types/works-qa.types';
import { photoUrl } from '../utils/photo-url';
import { SnagInlineForm, type SnagSubmitInput, type SnagSubmitResult } from './SnagInlineForm';
import type { AssignableUser } from '../hooks/useAssignableUsers';

interface PhotoSlotCardProps {
  slotKey: string;
  label: string;
  photoKey: string | null;
  vlm: VlmSlotResult | undefined;
  slotApproval?: SlotApproval | undefined;
  assignableUsers?: AssignableUser[];
  loadingUsers?: boolean;
  onUpload: (file: File) => Promise<void> | void;
  onOverride: (decision: 'pass' | 'fail', reason: string) => void;
  onApprove?: () => Promise<void>;
  onSnag?: (input: SnagSubmitInput) => Promise<SnagSubmitResult>;
  onView?: () => void;
  onUnassign?: () => void;
  onLinkExisting?: () => void;
  disabled?: boolean;
}

export function PhotoSlotCard({
  slotKey, label, photoKey, vlm, slotApproval,
  assignableUsers = [], loadingUsers,
  onUpload, onOverride, onApprove, onSnag,
  onView, onUnassign, onLinkExisting, disabled,
}: PhotoSlotCardProps) {
  const [showOverride, setShowOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [showSnagForm, setShowSnagForm] = useState(false);
  const [approving, setApproving] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmResnag, setConfirmResnag] = useState(false);

  // Wrap caller-supplied onUpload to track in-flight state and surface errors
  // inline. Without this, upload failures only hit the logger and the user
  // saw nothing (root cause of Johan's "die upload funksie nog nie werk nie").
  async function runUpload(file: File): Promise<void> {
    if (uploading) return;
    setUploadError(null);
    setUploading(true);
    try {
      await onUpload(file);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  const status: 'empty' | 'pass' | 'fail' | 'overridden' =
    !photoKey ? 'empty'
    : vlm?.overridden_by ? 'overridden'
    : vlm?.valid ? 'pass'
    : vlm ? 'fail'
    : 'empty';

  const borderColor =
    status === 'pass' ? 'border-green-500/40' :
    status === 'overridden' ? 'border-amber-500/40' :
    status === 'fail' ? 'border-red-500/40' :
    'border-zinc-700 border-dashed';

  const bgColor =
    status === 'pass' ? 'bg-green-500/5' :
    status === 'overridden' ? 'bg-amber-500/5' :
    status === 'fail' ? 'bg-red-500/5' :
    'bg-zinc-900';

  // Slot Droppable: only `!!photoKey` gates drop (slot already filled).
  // Pole-level `disabled` is intentionally NOT consulted — unassigned-→-slot
  // is a cleanup action allowed on approved poles too (Johan WA 2026-05-22).
  return (
    <Droppable droppableId={`slot:${slotKey}`} isDropDisabled={!!photoKey}>
      {(dropProvided, dropSnap) => (
        <div
          ref={dropProvided.innerRef}
          {...dropProvided.droppableProps}
          className={`rounded-lg border ${borderColor} ${bgColor} p-3 flex flex-col gap-2 transition-colors ${
            dropSnap.isDraggingOver ? 'ring-2 ring-teal-400/60' : ''
          } ${isDragOver ? 'ring-2 ring-teal-500/60 bg-teal-500/5' : ''}`}
          onDragOver={e => {
            if (photoKey) return;
            e.preventDefault();
            if (!isDragOver) setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={e => {
            // OS file-drop path (drops from the user's file manager). This is
            // a NEW-content path, distinct from the @hello-pangea/dnd
            // unassigned→slot move handled by the Droppable above. NEW content
            // is still gated on `disabled` (= pole approved) — same policy as
            // the upload button.
            if (disabled || photoKey) return;
            e.preventDefault();
            setIsDragOver(false);
            const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
            if (files.length === 0) return;
            if (files[0]) void runUpload(files[0]);
            log.debug('works-qa: slot drop', { slotKey, droppedCount: files.length });
          }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-300">{label}</span>
            <div className="flex items-center gap-2">
              {status === 'pass' && <span className="text-xs text-green-400">✓ VLM pass</span>}
              {status === 'overridden' && <span className="text-xs text-amber-400">✓ Overridden</span>}
              {status === 'fail' && <span className="text-xs text-red-400">⚠ VLM fail</span>}
              {photoKey && onUnassign && !disabled && (
                <button
                  type="button"
                  onClick={onUnassign}
                  className="text-zinc-500 hover:text-red-400 transition-colors"
                  aria-label="Move photo to unassigned bucket"
                  title="Move to unassigned"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {photoKey ? (
            <Draggable draggableId={`slot:${slotKey}:${photoKey}`} index={0} isDragDisabled={disabled}>
              {(dragProvided, dragSnap) => (
                <div
                  ref={dragProvided.innerRef}
                  {...dragProvided.draggableProps}
                  className={`relative w-full h-28 rounded overflow-hidden group ${dragSnap.isDragging ? 'ring-2 ring-teal-400 shadow-lg shadow-teal-500/30 z-50' : ''}`}
                >
                  {/* Drag handle — small grip icon, dragHandleProps lives here so
                      the photo button below remains clickable for the lightbox. */}
                  {!disabled && (
                    <div
                      {...dragProvided.dragHandleProps}
                      aria-label="Drag to reassign photo"
                      className="absolute top-1 left-1 z-10 p-1 rounded bg-black/60 text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
                    >
                      <GripVertical className="w-3 h-3" aria-hidden="true" />
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={onView}
                    disabled={!onView}
                    className="block w-full h-full focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:cursor-default"
                    aria-label={`Open ${label}`}
                  >
                    <img
                      src={photoUrl(photoKey)}
                      alt={label}
                      className="w-full h-full object-cover transition-transform group-hover:scale-[1.02]"
                      draggable={false}
                    />
                  </button>
                </div>
              )}
            </Draggable>
          ) : (
            <label
              className={`w-full h-28 flex items-center justify-center text-xs rounded transition-colors ${
                disabled || uploading
                  ? 'opacity-50 cursor-not-allowed text-zinc-600'
                  : isDragOver
                    ? 'bg-teal-500/10 border border-teal-500 border-solid text-teal-300 cursor-copy'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 cursor-pointer'
              }`}
              aria-busy={uploading}
            >
              {uploading ? 'Uploading…' : '+ Upload'}
              {/* `sr-only` (not `hidden`): Chromium silently suppresses the file
                  picker when the <input type="file"> is `display: none`, even
                  when triggered via a wrapping <label>. The screen-reader-only
                  utility keeps it in the layout tree so the picker opens. */}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={disabled || uploading}
                onChange={e => {
                  const f = e.target.files?.[0];
                  log.debug('works-qa: slot file picked', { hasFile: Boolean(f) });
                  if (f) void runUpload(f);
                  e.target.value = '';
                }}
              />
            </label>
          )}

          {uploadError && (
            <div
              role="alert"
              aria-live="assertive"
              className="flex items-center justify-between gap-2 text-xs text-red-400"
            >
              <span className="leading-tight">⚠ {uploadError}</span>
              <button
                type="button"
                onClick={() => setUploadError(null)}
                className="text-zinc-500 hover:text-zinc-300"
                aria-label="Dismiss upload error"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {vlm?.feedback && (
            <p className="text-xs text-zinc-500 leading-tight">{vlm.feedback}</p>
          )}

          {vlm?.dual_step && (
            <p className="text-[10px] text-amber-400/80 leading-tight">⧉ Same photo as another step</p>
          )}

          {/* Reuse an existing same-discipline photo for this step — e.g. a depth
              shot that also shows the end-plates. Available whenever the
              discipline isn't approved, regardless of current slot state. */}
          {onLinkExisting && !disabled && (
            <button
              type="button"
              onClick={onLinkExisting}
              className="text-xs text-teal-400 hover:text-teal-300 underline self-start"
            >
              ⧉ Use existing photo
            </button>
          )}

          {/* Per-photo Approve / Snag — orthogonal to discipline approval (Hein 2026-05-14).
              Only render when a photo is present; an empty slot has nothing to judge. */}
          {photoKey && slotApproval?.decision === 'approved' && !showSnagForm && !confirmResnag && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-green-400">✓ Approved</p>
              {!disabled && onSnag && (
                <button
                  type="button"
                  onClick={() => setConfirmResnag(true)}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-red-600/60 hover:bg-red-500 text-white"
                  title="Raise a snag against this approved photo"
                >
                  Re-snag
                </button>
              )}
            </div>
          )}

          {confirmResnag && !showSnagForm && (
            <div className="text-xs bg-amber-500/10 border border-amber-500/40 rounded p-2 flex flex-col gap-1">
              <p className="text-amber-300">Are you sure? This slot was previously approved.</p>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => { setConfirmResnag(false); setShowSnagForm(true); }}
                  className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white"
                >
                  Yes, raise snag
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmResnag(false)}
                  className="text-xs px-2 py-1 rounded text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {photoKey && slotApproval?.decision === 'snagged' && (
            <p className="text-xs text-red-400">⚠ Snagged</p>
          )}
          {photoKey && !slotApproval && !showSnagForm && !disabled && onApprove && onSnag && (
            <div className="flex gap-1">
              <button
                type="button"
                disabled={approving}
                onClick={async () => {
                  setApproving(true);
                  try { await onApprove(); } finally { setApproving(false); }
                }}
                className="text-xs px-2 py-1 rounded bg-green-600/80 hover:bg-green-500 text-white disabled:opacity-50"
              >
                {approving ? '…' : 'Approve'}
              </button>
              <button
                type="button"
                onClick={() => setShowSnagForm(true)}
                className="text-xs px-2 py-1 rounded bg-red-600/80 hover:bg-red-500 text-white"
              >
                Snag
              </button>
            </div>
          )}
          {photoKey && disabled && !slotApproval && !showSnagForm && onSnag && (
            <button
              type="button"
              onClick={() => setShowSnagForm(true)}
              className="text-[10px] self-start px-1.5 py-0.5 rounded bg-red-600/60 hover:bg-red-500 text-white"
              title="Raise a snag against this photo (discipline is approved)"
            >
              Snag
            </button>
          )}
          {showSnagForm && onSnag && (
            <SnagInlineForm
              assignableUsers={assignableUsers}
              loadingUsers={loadingUsers}
              onSubmit={async (input) => {
                const result = await onSnag(input);
                // Reset the re-snag confirmation banner so it doesn't linger
                // alongside the new "⚠ Snagged" badge after a successful submit.
                if (result.status === 'created' || result.status === 'amended') {
                  setConfirmResnag(false);
                }
                return result;
              }}
              onCancel={() => { setShowSnagForm(false); setConfirmResnag(false); }}
            />
          )}

          {status === 'fail' && !showOverride && (
            <button
              onClick={() => setShowOverride(true)}
              className="text-xs text-amber-400 hover:text-amber-300 underline self-start"
            >
              Override
            </button>
          )}

          {showOverride && (
            <div className="flex flex-col gap-1">
              <input
                type="text"
                placeholder="Override reason…"
                value={overrideReason}
                onChange={e => setOverrideReason(e.target.value)}
                className="text-xs bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-zinc-200"
              />
              <div className="flex gap-1">
                <button
                  onClick={() => { onOverride('pass', overrideReason); setShowOverride(false); }}
                  className="text-xs bg-amber-600 hover:bg-amber-500 text-white rounded px-2 py-1"
                >
                  Mark Pass
                </button>
                <button
                  onClick={() => setShowOverride(false)}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {dropProvided.placeholder}
        </div>
      )}
    </Droppable>
  );
}
