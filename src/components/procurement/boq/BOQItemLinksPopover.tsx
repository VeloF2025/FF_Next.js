/**
 * BOQItemLinksPopover — renders linked POs/GRNs/Invoices as inline links or badge + dropdown.
 */
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';

interface LinkItem {
  id: string;
  label: string;
  href: string;
}

interface BOQItemLinksPopoverProps {
  items: LinkItem[];
  badgeLabel: string;
  badgeColor: string;
}

export function BOQItemLinksPopover({ items, badgeLabel, badgeColor }: BOQItemLinksPopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  if (items.length === 0) return <span className="text-[var(--ff-text-tertiary)]">--</span>;

  if (items.length === 1) {
    return (
      <Link href={items[0]!.href} className={`text-xs font-mono ${badgeColor} hover:underline`}>
        {items[0]!.label}
      </Link>
    );
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${badgeColor} bg-opacity-20 hover:bg-opacity-30 transition-colors`}
      >
        {items.length} {badgeLabel}
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg shadow-lg z-20 min-w-[160px] py-1">
          {items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="block px-3 py-1.5 text-xs font-mono text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] transition-colors"
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
