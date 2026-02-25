import React from 'react';
import { UseFormRegister, FieldErrors, FieldError } from 'react-hook-form';
import { formatDisplayDateLong } from '@/utils/dateFormat';
import { AlertCircle } from 'lucide-react';

// Re-export FieldIcons from separate file for backward compatibility
export { FieldIcons } from './FieldIcons';

export type FieldMode = 'create' | 'edit' | 'view';
export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'email' | 'tel' | 'currency';

interface UniversalFieldProps {
  name: string;
  label: string;
  value?: string | number | boolean | null;
  mode?: FieldMode;
  type?: FieldType;
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  register?: UseFormRegister<Record<string, unknown>>;
  errors?: FieldErrors;
  icon?: React.ReactNode;
  hint?: string;
  rows?: number; // for textarea
  readOnly?: boolean;
  className?: string;
}

/**
 * Universal field component that maintains consistency across Create, Edit, and View modes
 * This is the SINGLE SOURCE for all field rendering in the application
 */
export function UniversalField({
  name,
  label,
  value,
  mode = 'create',
  type = 'text',
  required = false,
  placeholder,
  options,
  register,
  errors,
  icon,
  hint,
  rows = 3,
  readOnly = false,
  className = ''
}: UniversalFieldProps) {
  // View mode - read-only display
  if (mode === 'view') {
    return (
      <div className={`space-y-1 ${className}`}>
        <label className="block text-sm font-medium text-muted-foreground">
          {label}
        </label>
        <div className="flex items-center space-x-2">
          {icon && <span className="text-gray-400">{icon}</span>}
          <div className="text-foreground font-medium">
            {formatDisplayValue(value, type, options)}
          </div>
        </div>
      </div>
    );
  }

  // Get error for this field
  const fieldError = getNestedError(errors, name);

  // Create/Edit mode - editable fields
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-sm font-medium text-muted-foreground">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      
      <div className="relative">
        {icon && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <span className="text-gray-400">{icon}</span>
          </div>
        )}
        
        {type === 'textarea' ? (
          <textarea
            {...(register ? register(name, required ? { required: `${label} is required` } : {}) : {})}
            defaultValue={mode === 'edit' ? String(value ?? '') : undefined}
            rows={rows}
            placeholder={placeholder}
            readOnly={readOnly}
            className={`
              w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500
              ${icon ? 'pl-10' : ''}
              ${fieldError ? 'border-red-300' : 'border-border'}
              ${readOnly ? 'bg-background' : 'bg-card'}
            `}
          />
        ) : type === 'select' ? (
          <select
            {...(register ? register(name, required ? { required: `${label} is required` } : {}) : {})}
            defaultValue={mode === 'edit' ? String(value ?? '') : ''}
            disabled={readOnly}
            className={`
              w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500
              ${icon ? 'pl-10' : ''}
              ${fieldError ? 'border-red-300' : 'border-border'}
              ${readOnly ? 'bg-background' : 'bg-card'}
            `}
          >
            <option value="">Select {label.toLowerCase()}</option>
            {options?.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            {...(register ? register(name, { 
              required: required ? `${label} is required` : false,
              valueAsNumber: type === 'number' || type === 'currency'
            }) : {})}
            type={mapInputType(type)}
            defaultValue={mode === 'edit' ? String(value ?? '') : undefined}
            placeholder={placeholder}
            readOnly={readOnly}
            step={type === 'currency' ? '0.01' : type === 'number' ? 'any' : undefined}
            className={`
              w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500
              ${icon ? 'pl-10' : ''}
              ${fieldError ? 'border-red-300' : 'border-border'}
              ${readOnly ? 'bg-background' : 'bg-card'}
            `}
          />
        )}
      </div>
      
      {hint && !fieldError && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
      
      {fieldError && (
        <p className="text-sm text-red-600 flex items-center">
          <AlertCircle className="w-4 h-4 mr-1" />
{fieldError?.message || 'Field error'}
        </p>
      )}
    </div>
  );
}

// Helper function to format display values
function formatDisplayValue(
  value: string | number | boolean | null | undefined,
  type: FieldType,
  options?: Array<{ value: string; label: string }>
): React.ReactNode {
  if (value === null || value === undefined || value === '') {
    return <span className="text-gray-400">Not set</span>;
  }

  switch (type) {
    case 'currency':
      return new Intl.NumberFormat('en-ZA', {
        style: 'currency',
        currency: 'ZAR'
      }).format(typeof value === 'number' ? value : parseFloat(String(value)) || 0);
    
    case 'date':
      return formatDisplayDateLong(String(value));
    
    case 'select': {
      const option = options?.find(opt => opt.value === value);
      return option?.label || value;
    }
    
    default:
      return value;
  }
}

// Helper function to map field types to HTML input types
function mapInputType(type: FieldType): string {
  switch (type) {
    case 'currency':
    case 'number':
      return 'number';
    case 'email':
      return 'email';
    case 'tel':
      return 'tel';
    case 'date':
      return 'date';
    default:
      return 'text';
  }
}

// Helper function to get nested errors (for location.city, etc.)
function getNestedError(errors: FieldErrors | undefined, name: string): FieldError | null {
  if (!errors) return null;
  
  const keys = name.split('.');
  let current: Record<string, unknown> = errors;
  
  for (const key of keys) {
    if (current[key] === undefined) return null;
    current = current[key] as Record<string, unknown>;
  }
  
  return current as FieldError;
}

