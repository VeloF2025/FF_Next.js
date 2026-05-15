import { useState, useEffect } from 'react';
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
  onUpload: (file: File) => void;
  onOverride: (decision: 'pass' | 'fail', reason: string) => void;
  onApprove?: () => Promise<void>;
  onSnag?: (input: SnagSubmitInput) => Promise<SnagSubmitResult>;
  onView?: () => void;
  onUnassign?: () => void;
  disabled?: boolean;
}

export function PhotoSlotCard({
  slotKey, label, photoKey, vlm, slotApproval,
  assignableUsers = [], loadingUsers,
  onUpload, onOverride, onApprove, onSnag,
  onView, onUnassign, disabled,
}: PhotoSlotCardProps) {
  const [showOverride, setShowOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [showSnagForm, setShowSnagForm] = useState(false);
  const [approving, setApproving] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // Close the snag form if the discipline becomes approved while it is open.
  // Without this, an un-approval (discipline re-opened) would silently restore
  // the previously-open form because `showSnagForm` would still be true.
  useEffect(() => { if (disabled) setShowSnagForm(false); }, [disabled]);

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

  return (
    <Droppable droppableId={`slot:${slotKey}`} isDropDisabled={disabled || !!photoKey}>
      {(dropProvided, dropSnap) => (
        <div
          ref={dropProvided.innerRef}
          {...dropProvided.droppableProps}
          className={`rounded-lg border ${borderColor} ${bgColor} p-3 flex flex-col gap-2 transition-colors ${
            dropSnap.isDraggingOver ? 'ring-2 ring-teal-400/60' : ''
          } ${isDragOver ? 'ring-2 ring-teal-500/60 bg-teal-500/5' : ''}`}
          onDragOver={e => {
            if (disabled || photoKey) return;
            e.preventDefault();
            if (!isDragOver) setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={e => {
            if (disabled || photoKey) return;
            e.preventDefault();
            setIsDragOver(false);
            const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
            if (files.length === 0) return;
            if (files[0]) onUpload(files[0]);
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
                disabled
                  ? 'opacity-50 cursor-not-allowed text-zinc-600'
                  : isDragOver
                    ? 'bg-teal-500/10 border border-teal-500 border-solid text-teal-300 cursor-copy'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 cursor-pointer'
              }`}
            >
              + Upload
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={disabled}
                onChange={e => {
                  const f = e.target.files?.[0];
                  log.debug('works-qa: slot file picked', { hasFile: Boolean(f) });
                  if (f) onUpload(f);
                  e.target.value = '';
                }}
              />
            </label>
          )}

          {vlm?.feedback && (
            <p className="text-xs text-zinc-500 leading-tight">{vlm.feedback}</p>
          )}

          {/* Per-photo Approve / Snag — orthogonal to discipline approval (Hein 2026-05-14).
              Only render when a photo is present; an empty slot has nothing to judge. */}
          {photoKey && slotApproval?.decision === 'approved' && (
            <p className="text-xs text-green-400">✓ Approved</p>
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
          {showSnagForm && onSnag && !disabled && (
            <SnagInlineForm
              assignableUsers={assignableUsers}
              loadingUsers={loadingUsers}
              onSubmit={onSnag}
              onCancel={() => setShowSnagForm(false)}
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
