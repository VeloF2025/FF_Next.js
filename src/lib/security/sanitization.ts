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
export function sanitizeObject<T extends Record<string, unknown>>(
  obj: T,
  allowHtml: boolean = false
): T {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const sanitized: Record<string, unknown> = Array.isArray(obj)
    ? ([] as unknown as Record<string, unknown>)
    : {};

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      sanitized[key] = value;
    } else if (typeof value === 'string') {
      sanitized[key] = allowHtml ? sanitizeHtml(value) : sanitizeText(value);
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeObject(value as Record<string, unknown>, allowHtml);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized as T;
}

/**
 * Sanitize specific fields in client/customer data.
 * Generic over T so callers pass their own typed form data and get it back typed.
 */
export function sanitizeClientData<T extends object>(data: T): T {
  const d = data as Record<string, unknown>;
  return {
    ...data,
    name: sanitizeText(d['name'] as string | undefined),
    email: sanitizeText(d['email'] as string | undefined),
    phone: sanitizeText(d['phone'] as string | undefined),
    city: sanitizeText(d['city'] as string | undefined),
    province: sanitizeText(d['province'] as string | undefined),
    postalCode: sanitizeText(d['postalCode'] as string | undefined),
    country: sanitizeText(d['country'] as string | undefined),
    contactPerson: sanitizeText(d['contactPerson'] as string | undefined),
    notes: sanitizeText(d['notes'] as string | undefined),
    website: sanitizeText(d['website'] as string | undefined),
  };
}

/**
 * Sanitize supplier data.
 * Generic over T so callers pass their own typed form data and get it back typed.
 */
export function sanitizeSupplierData<T extends object>(data: T): T {
  const d = data as Record<string, unknown>;
  const addresses = d['addresses'] as
    | { physical?: Record<string, unknown> }
    | undefined;
  return {
    ...data,
    name: sanitizeText(d['name'] as string | undefined),
    companyName: sanitizeText(d['companyName'] as string | undefined),
    email: sanitizeText(d['email'] as string | undefined),
    phone: sanitizeText(d['phone'] as string | undefined),
    contactName: sanitizeText(d['contactName'] as string | undefined),
    contactEmail: sanitizeText(d['contactEmail'] as string | undefined),
    contactPhone: sanitizeText(d['contactPhone'] as string | undefined),
    notes: sanitizeText(d['notes'] as string | undefined),
    // Sanitize address fields if present
    addresses: addresses ? {
      physical: addresses.physical ? {
        ...addresses.physical,
        street1: sanitizeText(addresses.physical['street1'] as string | undefined),
        street2: sanitizeText(addresses.physical['street2'] as string | undefined),
        city: sanitizeText(addresses.physical['city'] as string | undefined),
        state: sanitizeText(addresses.physical['state'] as string | undefined),
        postalCode: sanitizeText(addresses.physical['postalCode'] as string | undefined),
        country: sanitizeText(addresses.physical['country'] as string | undefined),
      } : undefined,
    } : undefined,
  };
}

/**
 * Sanitize product/stock item data.
 * Generic over T so callers pass their own typed form data and get it back typed.
 */
export function sanitizeProductData<T extends object>(data: T): T {
  const d = data as Record<string, unknown>;
  return {
    ...data,
    name: sanitizeText(d['name'] as string | undefined),
    description: sanitizeText(d['description'] as string | undefined),
    sku: sanitizeText(d['sku'] as string | undefined),
    barcode: sanitizeText(d['barcode'] as string | undefined),
    category: sanitizeText(d['category'] as string | undefined),
    manufacturer: sanitizeText(d['manufacturer'] as string | undefined),
    notes: sanitizeText(d['notes'] as string | undefined),
  };
}

/**
 * Sanitize order/purchase order data.
 * Generic over T so callers pass their own typed form data and get it back typed.
 */
export function sanitizeOrderData<T extends object>(data: T): T {
  const d = data as Record<string, unknown>;
  const items = d['items'] as Array<Record<string, unknown>> | undefined;
  return {
    ...data,
    notes: sanitizeText(d['notes'] as string | undefined),
    deliveryInstructions: sanitizeText(d['deliveryInstructions'] as string | undefined),
    deliveryAddress: sanitizeText(d['deliveryAddress'] as string | undefined),
    shippingAddress: sanitizeText(d['shippingAddress'] as string | undefined),
    billingAddress: sanitizeText(d['billingAddress'] as string | undefined),
    // Sanitize line items if present
    items: items ? items.map((item) => ({
      ...item,
      description: sanitizeText(item['description'] as string | undefined),
      notes: sanitizeText(item['notes'] as string | undefined),
    })) : undefined,
  };
}

/**
 * Middleware-friendly sanitization function
 * Can be used in API routes to sanitize request body
 */
export function sanitizeRequestBody(body: Record<string, unknown>): Record<string, unknown> {
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
