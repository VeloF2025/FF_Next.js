import {
  ServiceType
} from '@/types/client.types';

/**
 * Helper to parse enum values
 */
export function parseEnumValue<T>(value: string | undefined, enumType: Record<string, string>, defaultValue: T): T {
  if (!value) return defaultValue;
  
  const upperValue = value.toUpperCase().replace(/\s+/g, '_');
  const enumValues = Object.values(enumType) as string[];
  
  for (const enumValue of enumValues) {
    if (enumValue.toUpperCase().replace(/\s+/g, '_') === upperValue) {
      return enumValue as T;
    }
  }
  
  return defaultValue;
}

/**
 * Parse service types from comma-separated string
 */
export function parseServiceTypes(servicesString: string | undefined): ServiceType[] {
  if (!servicesString) return [];
  
  const services: ServiceType[] = [];
  const servicesList = servicesString.split(',').map(s => s.trim());
  
  for (const service of servicesList) {
    const parsedService = parseEnumValue(service, ServiceType, null);
    if (parsedService) {
      services.push(parsedService as ServiceType);
    }
  }
  
  return services;
}

/**
 * Parse tags from comma-separated string
 */
export function parseTags(tagsString: string | undefined): string[] {
  if (!tagsString) return [];
  return tagsString.split(',').map(t => t.trim()).filter(t => t.length > 0);
}

/**
 * Parse number with fallback
 */
export function parseNumber(value: string | number | undefined, defaultValue: number): number {
  if (value === undefined || value === '') return defaultValue;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return isNaN(num) ? defaultValue : num;
}