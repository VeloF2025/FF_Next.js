'use client';

/**
 * BoxGroupChip — one row standing for a whole scanned carton.
 *
 * A nine-serial box would otherwise flood the scan list and bury the loose
 * units the storeman still has to add. Collapsed by default: the summary is
 * what he checks ("9 valid"), the member list is what he opens when it isn't.
 *
 * Rejected members stay visible inside the group rather than disappearing —
 * the box is issued without them, and he needs to know which ones to set aside.
 */

import { useState } from 'react';
import { ChevronDown, Package, Trash2 } from 'lucide-react';
import { SerialChip } from './SerialChip';
import type { PwaScannedSerial } from '@/modules/field-stock-pwa/types';

export interface BoxGroupChipProps {
  groupId: string;
  label: string;
  members: PwaScannedSerial[];
  onRemoveGroup: (groupId: string) => void;
  onRemoveMember: (serialNumber: string) => void;
}

export function BoxGroupChip({
  groupId,
  label,
  members,
  onRemoveGroup,
  onRemoveMember,
}: BoxGroupChipProps) {
  const [open, setOpen] = useState(false);

  const valid = members.filter((m) => m.state === 'valid').length;
  const invalid = members.filter((m) => m.state === 'invalid').length;
  const pending = members.filter((m) => m.state === 'pending-validation').length;

  const border =
    invalid > 0 ? 'border-amber-800 bg-amber-950/20' : 'border-emerald-800 bg-emerald-950/20';

  return (
    <li className={`rounded-lg border ${border}`}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Package className="w-4 h-4 text-neutral-300 flex-shrink-0" />
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex-1 min-w-0 text-left">
          <div className="text-sm font-medium text-white">{label}</div>
          <div className="text-xs text-neutral-400 mt-0.5">
            {pending > 0
              ? `Checking ${pending}…`
              : `${valid} valid${invalid > 0 ? ` · ${invalid} rejected` : ''}`}
          </div>
        </button>
        <ChevronDown
          className={`w-4 h-4 text-neutral-500 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
        <button
          type="button"
          onClick={() => onRemoveGroup(groupId)}
          aria-label="Remove this box"
          className="text-neutral-500 hover:text-rose-300 flex-shrink-0 p-0.5"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {open && (
        <ul className="space-y-1.5 px-2 pb-2">
          {members.map((m) => (
            <SerialChip key={m.serialNumber} serial={m} onRemove={onRemoveMember} />
          ))}
        </ul>
      )}
    </li>
  );
}
