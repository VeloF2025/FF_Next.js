/**
 * Input Sanitization Utilities
 * Prevents Stored XSS attacks by sanitizing user-provided text inputs
 * 
 * Reference: AUDIT-API.md C-003
 * 
 * Usage:
 * - Use sanitizeText() for plain text fields (names, addresses, notes)
 * - Use sanitizeHtml() for rich text fields that need to preserve some HTML
 * - Use sanitizeObject() to recursively sanitize all string values in an object
 */

import DOMPurify from 'isomorphic-dompurify';

/**
 * Configuration for DOMPurify
 */
const SANITIZE_CONFIG = {
  // Strip all HTML tags for plain text
  ALLOWED_TAGS: [] as string[],
  ALLOWED_ATTR: [] as string[],
  KEEP_CONTENT: true, // Keep text content, remove tags
  ALLOW_DATA_ATTR: false,
};

/**
 * Configuration for fields that may contain limited HTML (e.g., rich text editors)
 */
const SANITIZE_HTML_CONFIG = {
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li'],
  ALLOWED_ATTR: ['href', 'target'],
  ALLOW_DATA_ATTR: false,
};

/**
 * Sanitize plain text input by removing all HTML/script tags
 * Use for: customer names, addresses, product names, order notes, etc.
 * 
 * @param input - The text to sanitize
 * @returns Sanitized text with all HTML removed
 */
export function sanitizeText(input: string | null | undefined): string {
  if (!input) return '';
  
  // Trim whitespace
  const trimmed = input.trim();
  if (!trimmed) return '';
  
  // Remove all HTML tags and scripts
  return DOMPurify.sanitize(trimmed, SANITIZE_CONFIG);
}

/**
 * Sanitize HTML input allowing only safe tags
 * Use for: rich text descriptions, formatted notes
 * 
 * @param input - The HTML to sanitize
 * @returns Sanitized HTML with dangerous tags/attributes removed
 */
export function sanitizeHtml(input: string | null | undefined): string {
  if (!input) return '';
  
  const trimmed = input.trim();
  if (!trimmed) return '';
  
  return DOMPurify.sanitize(trimmed, SANITIZE_HTML_CONFIG);
}

/**
 * Sanitize all string values in an object recursively
 * Use for: API request bodies, form data objects
 * 
 * @param obj - Object to sanitize
 * @param allowHtml - If true, use HTML sanitization instead of plain text
 * @returns New object with all string values sanitized
 */
export function sanitizeObject<T extends Record<string, any>>(
  obj: T,
  allowHtml: boolean = false
): T {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const sanitized: any = Array.isArray(obj) ? [] : {};

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      sanitized[key] = value;
    } else if (typeof value === 'string') {
      sanitized[key] = allowHtml ? sanitizeHtml(value) : sanitizeText(value);
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeObject(value, allowHtml);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized as T;
}

/**
 * Sanitize specific fields in client/customer data
 */
export function sanitizeClientData(data: any): any {
  return {
    ...data,
    name: sanitizeText(data.name),
    email: sanitizeText(data.email),
    phone: sanitizeText(data.phone),
    address: sanitizeText(data.address),
    city: sanitizeText(data.city),
    province: sanitizeText(data.province),
    postalCode: sanitizeText(data.postalCode),
    country: sanitizeText(data.country),
    contactPerson: sanitizeText(data.contactPerson),
    notes: sanitizeText(data.notes),
    website: sanitizeText(data.website),
  };
}

/**
 * Sanitize supplier data
 */
export function sanitizeSupplierData(data: any): any {
  return {
    ...data,
    name: sanitizeText(data.name),
    companyName: sanitizeText(data.companyName),
    email: sanitizeText(data.email),
    phone: sanitizeText(data.phone),
    contactName: sanitizeText(data.contactName),
    contactEmail: sanitizeText(data.contactEmail),
    contactPhone: sanitizeText(data.contactPhone),
    notes: sanitizeText(data.notes),
    // Sanitize address fields if present
    addresses: data.addresses ? {
      physical: data.addresses.physical ? {
        street1: sanitizeText(data.addresses.physical.street1),
        street2: sanitizeText(data.addresses.physical.street2),
        city: sanitizeText(data.addresses.physical.city),
        state: sanitizeText(data.addresses.physical.state),
        postalCode: sanitizeText(data.addresses.physical.postalCode),
        country: sanitizeText(data.addresses.physical.country),
      } : undefined,
    } : undefined,
  };
}

/**
 * Sanitize product/stock item data
 */
export function sanitizeProductData(data: any): any {
  return {
    ...data,
    name: sanitizeText(data.name),
    description: sanitizeText(data.description),
    sku: sanitizeText(data.sku),
    barcode: sanitizeText(data.barcode),
    category: sanitizeText(data.category),
    manufacturer: sanitizeText(data.manufacturer),
    notes: sanitizeText(data.notes),
  };
}

/**
 * Sanitize order/purchase order data
 */
export function sanitizeOrderData(data: any): any {
  return {
    ...data,
    notes: sanitizeText(data.notes),
    deliveryInstructions: sanitizeText(data.deliveryInstructions),
    deliveryAddress: sanitizeText(data.deliveryAddress),
    shippingAddress: sanitizeText(data.shippingAddress),
    billingAddress: sanitizeText(data.billingAddress),
    // Sanitize line items if present
    items: data.items ? data.items.map((item: any) => ({
      ...item,
      description: sanitizeText(item.description),
      notes: sanitizeText(item.notes),
    })) : undefined,
  };
}

/**
 * Middleware-friendly sanitization function
 * Can be used in API routes to sanitize request body
 */
export function sanitizeRequestBody(body: any): any {
  if (!body || typeof body !== 'object') {
    return body;
  }
  
  return sanitizeObject(body, false);
}

/**
 * Test if a string contains potential XSS attack vectors
 * Use for logging/monitoring suspicious inputs
 */
export function containsXssPatterns(input: string): boolean {
  if (!input) return false;
  
  const xssPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i, // Event handlers like onclick=
    /<iframe/i,
    /<object/i,
    /<embed/i,
    /eval\(/i,
  ];
  
  return xssPatterns.some(pattern => pattern.test(input));
}

/**
 * Sanitize and validate, throwing error if XSS detected
 * Use when you want to reject malicious input rather than silently sanitize
 */
export function sanitizeAndValidate(input: string, fieldName: string = 'Input'): string {
  const original = input;
  const sanitized = sanitizeText(input);
  
  // If sanitization changed the input significantly, it likely contained XSS
  if (original !== sanitized && containsXssPatterns(original)) {
    throw new Error(`${fieldName} contains potentially malicious content`);
  }
  
  return sanitized;
}
