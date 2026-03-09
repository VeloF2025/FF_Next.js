/**
 * ContractorFormFields - Form field components for contractor data entry/editing
 * Provides dropdowns for Business Type, Province, Services, etc.
 */

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/shared/components/ui/Select';
import { BUSINESS_TYPES, SA_PROVINCES } from '@/constants/contractor/validation';

export type BusinessType = 'individual' | 'company' | 'partnership' | 'other';
export type SAProvince = string;

// Local placeholder - replace with actual service if available
interface ServiceTemplate {
  id: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
}

const ServiceTemplateApiService = {
  getTemplates: async () => [] as ServiceTemplate[],
  getTemplate: async (id: string) => null as ServiceTemplate | null,
  getServiceTemplates: async (_options: any) => ({ data: [] as ServiceTemplate[] }),
};

interface BusinessTypeSelectProps {
  value?: BusinessType;
  onChange: (value: BusinessType) => void;
  error?: string;
  className?: string;
  disabled?: boolean;
}

export function BusinessTypeSelect({
  value,
  onChange,
  error,
  className = '',
  disabled = false
}: BusinessTypeSelectProps) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-muted-foreground mb-1">
        Business Type*
      </label>
      <Select 
        value={value || ''} 
        onValueChange={(newValue) => onChange(newValue as BusinessType)}
        disabled={disabled}
      >
        <SelectTrigger className={error ? 'border-red-500' : ''}>
          <SelectValue placeholder="Select business type" />
        </SelectTrigger>
        <SelectContent>
          {BUSINESS_TYPES.map((type) => (
            <SelectItem key={type} value={type}>
              {type}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && (
        <p className="text-red-500 text-xs mt-1">{error}</p>
      )}
      <p className="text-muted-foreground text-xs mt-1">
        South African business entity type
      </p>
    </div>
  );
}

interface ProvinceSelectProps {
  value?: SAProvince;
  onChange: (value: SAProvince) => void;
  error?: string;
  className?: string;
  disabled?: boolean;
  label?: string;
}

export function ProvinceSelect({
  value,
  onChange,
  error,
  className = '',
  disabled = false,
  label = 'Province*'
}: ProvinceSelectProps) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-muted-foreground mb-1">
        {label}
      </label>
      <Select 
        value={value || ''} 
        onValueChange={(newValue) => onChange(newValue as SAProvince)}
        disabled={disabled}
      >
        <SelectTrigger className={error ? 'border-red-500' : ''}>
          <SelectValue placeholder="Select province" />
        </SelectTrigger>
        <SelectContent>
          {SA_PROVINCES.map((province) => (
            <SelectItem key={province} value={province}>
              {province}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && (
        <p className="text-red-500 text-xs mt-1">{error}</p>
      )}
    </div>
  );
}

interface RegionSelectProps {
  value?: SAProvince[];
  onChange: (value: SAProvince[]) => void;
  error?: string;
  className?: string;
  disabled?: boolean;
}

export function RegionSelect({
  value = [],
  onChange,
  error,
  className = '',
  disabled = false
}: RegionSelectProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleProvinceToggle = (province: SAProvince) => {
    const newValue = value.includes(province)
      ? value.filter(p => p !== province)
      : [...value, province];
    onChange(newValue);
  };

  const handleRemoveProvince = (province: SAProvince) => {
    onChange(value.filter(p => p !== province));
  };

  return (
    <div className={className}>
      <label className="block text-sm font-medium text-muted-foreground mb-1">
        Region of Operations
      </label>
      <div className="relative">
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className={`
            flex h-10 w-full items-center justify-between rounded-md border px-3 py-2 text-sm
            ${error ? 'border-red-500' : 'border-border'}
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent cursor-pointer hover:border-gray-400'}
            bg-card text-foreground
          `}
        >
          <span className={value.length === 0 ? 'text-muted-foreground' : ''}>
            {value.length === 0 
              ? 'Select provinces...' 
              : `${value.length} province${value.length > 1 ? 's' : ''} selected`
            }
          </span>
        </button>
        
        {isOpen && !disabled && (
          <>
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setIsOpen(false)} 
            />
            <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-md shadow-lg">
              <div className="max-h-60 overflow-y-auto p-1">
                {SA_PROVINCES.map((province) => (
                  <label
                    key={province}
                    className="flex items-center px-2 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={value.includes(province)}
                      onChange={() => handleProvinceToggle(province)}
                      className="mr-2 h-4 w-4 rounded border-border text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-sm">{province}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      
      {/* Selected provinces display */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {value.map((province) => (
            <span
              key={province}
              className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200"
            >
              {province}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleRemoveProvince(province)}
                  className="ml-1 text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-200"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      
      {error && (
        <p className="text-red-500 text-xs mt-1">{error}</p>
      )}
      <p className="text-muted-foreground text-xs mt-1">
        Select all provinces where contractor operates
      </p>
    </div>
  );
}

interface ServiceSelectProps {
  value?: string[];
  onChange: (value: string[]) => void;
  error?: string;
  className?: string;
  disabled?: boolean;
}

export function ServiceSelect({
  value = [],
  onChange,
  error,
  className = '',
  disabled = false
}: ServiceSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [availableServices, setAvailableServices] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadServices = async () => {
      try {
        setIsLoading(true);
        
        // Try to load from API first
        try {
          const response = await ServiceTemplateApiService.getServiceTemplates({
            isActive: true,
            limit: 1000
          });
          
          // Extract service names (not deliverables)
          const services = response.data
            .filter((template: ServiceTemplate) => template.parentId !== null)
            .map((template: ServiceTemplate) => template.name);
            
          if (services.length > 0) {
            setAvailableServices(services);
            return;
          }
        } catch (apiError) {
          // TODO: Replace with proper logging - Service templates API not available, using fallback
        }
        
        // Fallback to comprehensive default services
        const fallbackServices = [
          // Service Delivery
          'Fibre Installation',
          'Network Maintenance', 
          'Customer Premise Equipment',
          'Site Survey',
          'Project Management',
          
          // Civil Works
          'Trenching',
          'Ducting Installation',
          'Road Crossing',
          'Reinstatement',
          'Civil Construction',
          
          // Optical Services
          'Fibre Splicing',
          'Network Testing',
          'Equipment Installation',
          'Optical Equipment Maintenance',
          'Network Commissioning'
        ];
        
        setAvailableServices(fallbackServices);
        
      } catch (error) {
        // TODO: Replace with proper logging - Error in service loading
        // Final fallback to basic services
        setAvailableServices(['Service Delivery', 'Civil', 'Optical']);
      } finally {
        setIsLoading(false);
      }
    };

    loadServices();
  }, []);

  const handleServiceToggle = (service: string) => {
    const newValue = value.includes(service)
      ? value.filter(s => s !== service)
      : [...value, service];
    onChange(newValue);
  };

  const handleRemoveService = (service: string) => {
    onChange(value.filter(s => s !== service));
  };

  if (isLoading) {
    return (
      <div className={className}>
        <label className="block text-sm font-medium text-muted-foreground mb-1">
          Services
        </label>
        <div className="h-10 bg-secondary rounded-md animate-pulse" />
        <p className="text-muted-foreground text-xs mt-1">Loading services...</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <label className="block text-sm font-medium text-muted-foreground mb-1">
        Services
      </label>
      <div className="relative">
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className={`
            flex h-10 w-full items-center justify-between rounded-md border px-3 py-2 text-sm
            ${error ? 'border-red-500' : 'border-border'}
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent cursor-pointer hover:border-gray-400'}
            bg-card text-foreground
          `}
        >
          <span className={value.length === 0 ? 'text-muted-foreground' : ''}>
            {value.length === 0 
              ? 'Select services...' 
              : `${value.length} service${value.length > 1 ? 's' : ''} selected`
            }
          </span>
        </button>
        
        {isOpen && !disabled && (
          <>
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setIsOpen(false)} 
            />
            <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-md shadow-lg">
              <div className="max-h-60 overflow-y-auto p-1">
                {availableServices.map((service) => (
                  <label
                    key={service}
                    className="flex items-center px-2 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={value.includes(service)}
                      onChange={() => handleServiceToggle(service)}
                      className="mr-2 h-4 w-4 rounded border-border text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-sm">{service}</span>
                  </label>
                ))}
                {availableServices.length === 0 && (
                  <div className="px-2 py-2 text-sm text-muted-foreground">
                    No services available
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      
      {/* Selected services display */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {value.map((service) => (
            <span
              key={service}
              className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200"
            >
              {service}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleRemoveService(service)}
                  className="ml-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      
      {error && (
        <p className="text-red-500 text-xs mt-1">{error}</p>
      )}
      <p className="text-muted-foreground text-xs mt-1">
        Select services from your configured rate card templates
      </p>
    </div>
  );
}