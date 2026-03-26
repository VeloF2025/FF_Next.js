import * as React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    const base = 'inline-flex items-center justify-center rounded font-medium transition-colors focus:outline-none disabled:opacity-50';
    const variants: Record<string, string> = {
      default: 'bg-blue-600 text-white hover:bg-blue-500',
      outline: 'border border-slate-600 text-slate-200 hover:bg-slate-700',
      ghost: 'text-slate-200 hover:bg-slate-700',
      destructive: 'bg-red-600 text-white hover:bg-red-500',
    };
    const sizes: Record<string, string> = {
      default: 'px-4 py-2 text-sm',
      sm: 'px-3 py-1.5 text-xs',
      lg: 'px-6 py-3 text-base',
      icon: 'p-2',
    };
    return (
      <button
        ref={ref}
        className={[base, variants[variant], sizes[size], className].filter(Boolean).join(' ')}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
