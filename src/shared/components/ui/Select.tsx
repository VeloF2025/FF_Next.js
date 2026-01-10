import React, { createContext, useContext, useState, forwardRef } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { clsx } from 'clsx';

interface SelectContextType {
  value: string;
  onValueChange: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const SelectContext = createContext<SelectContextType | undefined>(undefined);

interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}

export function Select({ value = '', onValueChange = () => {}, children, disabled = false }: SelectProps) {
  const [open, setOpen] = useState(false);

  return (
    <SelectContext.Provider value={{ value, onValueChange, open, setOpen }}>
      <div className={clsx('relative', disabled && 'opacity-50 cursor-not-allowed')}>
        {children}
      </div>
    </SelectContext.Provider>
  );
}

interface SelectTriggerProps {
  className?: string;
  children: React.ReactNode;
}

export const SelectTrigger = forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, children, ...props }, ref) => {
    const context = useContext(SelectContext);
    if (!context) throw new Error('SelectTrigger must be used within Select');

    const { open, setOpen } = context;

    return (
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen(!open)}
        className={clsx(
          'flex h-10 w-full items-center justify-between rounded-md border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] px-3 py-2 text-sm placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      >
        {children}
        <ChevronDown className={clsx('h-4 w-4 opacity-50 transition-transform', open && 'rotate-180')} />
      </button>
    );
  }
);

SelectTrigger.displayName = 'SelectTrigger';

interface SelectValueProps {
  placeholder?: string;
}

export function SelectValue({ placeholder }: SelectValueProps) {
  const context = useContext(SelectContext);
  if (!context) throw new Error('SelectValue must be used within Select');

  const { value } = context;

  return (
    <span className={clsx(!value && 'text-[var(--ff-text-tertiary)]')}>
      {value || placeholder}
    </span>
  );
}

interface SelectContentProps {
  className?: string;
  children: React.ReactNode;
}

export function SelectContent({ className, children }: SelectContentProps) {
  const context = useContext(SelectContext);
  if (!context) throw new Error('SelectContent must be used within Select');

  const { open, setOpen } = context;

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={() => setOpen(false)}
      />
      <div
        className={clsx(
          'absolute z-50 min-w-[8rem] overflow-hidden rounded-md border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-1 text-[var(--ff-text-primary)] shadow-md animate-in fade-in-0 zoom-in-95',
          'top-full mt-1 w-full',
          className
        )}
      >
        {children}
      </div>
    </>
  );
}

interface SelectItemProps {
  value: string;
  className?: string;
  children: React.ReactNode;
}

export function SelectItem({ value, className, children }: SelectItemProps) {
  const context = useContext(SelectContext);
  if (!context) throw new Error('SelectItem must be used within Select');

  const { value: selectedValue, onValueChange, setOpen } = context;
  const isSelected = value === selectedValue;

  return (
    <div
      className={clsx(
        'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-[var(--ff-bg-hover)] hover:bg-[var(--ff-bg-hover)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        isSelected && 'bg-[var(--ff-bg-hover)]',
        className
      )}
      onClick={() => {
        onValueChange(value);
        setOpen(false);
      }}
    >
      {children}
      {isSelected && (
        <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
          <Check className="h-4 w-4" />
        </span>
      )}
    </div>
  );
}