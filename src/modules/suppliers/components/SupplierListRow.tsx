/**
 * SupplierListRow — compact list-view row for a single supplier.
 * Used as alternative to SupplierCard in the Suppliers page.
 * 🟢 WORKING: Mirrors all key data from SupplierCard in a single row
 */

'use client';

import { Star, Phone, Mail, MoreVertical } from 'lucide-react';
import type { Supplier } from '@/types/supplier.types';
import { SupplierStatus } from '@/types/supplier.types';

interface Props {
  supplier: Supplier;
}

function statusColor(status: SupplierStatus): string {
  switch (status) {
    case SupplierStatus.ACTIVE:
      return 'text-green-400 bg-green-500/10 border-green-500/30';
    case SupplierStatus.INACTIVE:
      return 'text-red-400 bg-red-500/10 border-red-500/30';
    case SupplierStatus.PENDING:
      return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
    default:
      return 'text-gray-400 bg-gray-500/10 border-gray-500/30';
  }
}

function StarRating({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`w-3 h-3 ${n <= Math.round(value) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`}
        />
      ))}
    </span>
  );
}

export function SupplierListRow({ supplier }: Props) {
  const name = supplier.companyName ?? supplier.name ?? '—';
  const reg = supplier.registrationNo ?? supplier.registrationNumber ?? '—';
  const email = supplier.primaryContact?.email ?? supplier.email ?? null;
  const phone = supplier.primaryContact?.phone ?? supplier.phone ?? null;
  const category = supplier.categories?.[0] ?? null;
  const rating =
    typeof supplier.rating === 'number'
      ? supplier.rating
      : (supplier.rating?.overall ?? 0);

  return (
    <div className="flex items-center gap-4 px-4 py-3 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors group">
      {/* Status dot + name */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border uppercase tracking-wide shrink-0 ${statusColor(supplier.status)}`}
        >
          {supplier.status}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--ff-text-primary)] truncate">{name}</p>
          <p className="text-[11px] text-[var(--ff-text-tertiary)]">Reg: {reg}</p>
        </div>
        {supplier.isPreferred && (
          <span title="Preferred supplier"><Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400 shrink-0" /></span>
        )}
      </div>

      {/* Category */}
      <div className="hidden md:block w-36 shrink-0">
        {category ? (
          <span className="inline-block px-2 py-0.5 rounded text-[11px] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] capitalize">
            {category.replace(/_/g, ' ')}
          </span>
        ) : (
          <span className="text-[11px] text-[var(--ff-text-tertiary)]">—</span>
        )}
      </div>

      {/* Contact */}
      <div className="hidden lg:flex flex-col gap-0.5 w-48 shrink-0">
        {email && (
          <span className="flex items-center gap-1.5 text-[11px] text-[var(--ff-text-secondary)] truncate">
            <Mail className="w-3 h-3 shrink-0" />
            <span className="truncate">{email}</span>
          </span>
        )}
        {phone && (
          <span className="flex items-center gap-1.5 text-[11px] text-[var(--ff-text-secondary)]">
            <Phone className="w-3 h-3 shrink-0" />
            {phone}
          </span>
        )}
        {!email && !phone && (
          <span className="text-[11px] text-[var(--ff-text-tertiary)]">No contact</span>
        )}
      </div>

      {/* Rating */}
      <div className="hidden sm:flex flex-col items-end gap-0.5 w-24 shrink-0">
        <StarRating value={rating} />
        <span className="text-[10px] text-[var(--ff-text-tertiary)]">
          {rating > 0 ? rating.toFixed(1) : 'No rating'}
        </span>
      </div>

      {/* Actions menu placeholder */}
      <button
        className="p-1 text-[var(--ff-text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity hover:text-[var(--ff-text-primary)] rounded"
        aria-label="Supplier options"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
    </div>
  );
}
