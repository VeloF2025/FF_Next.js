import { X } from 'lucide-react';

interface PoleFormHeaderProps {
  onCancel: () => void;
}

export function PoleFormHeader({ onCancel }: PoleFormHeaderProps) {
  return (
    <div className="sticky top-0 z-10 bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] px-4 py-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[var(--ff-text-primary)]">Capture Pole Data</h1>
        <button
          onClick={onCancel}
          className="p-2 hover:bg-[var(--ff-bg-hover)] rounded-lg"
        >
          <X className="h-5 w-5 text-[var(--ff-text-secondary)]" />
        </button>
      </div>
    </div>
  );
}