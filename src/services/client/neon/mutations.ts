import { getSql } from '@/lib/neon-sql';
import { ClientFormData } from '@/types/client.types';
import { buildMetadata, extractPaymentTerms } from './mappers';
import { log } from '@/lib/logger';
import { sanitizeClientData } from '@/lib/security/sanitization';

/**
 * Create a new client
 */
export async function createClient(data: ClientFormData): Promise<string> {
  try {
    // Sanitize all text inputs to prevent XSS
    const sanitized = sanitizeClientData(data);
    
    // Prepare metadata JSON
    const metadata = {
      website: sanitized.website,
      category: sanitized.category || 'STANDARD',
      priority: sanitized.priority || 'MEDIUM',
      account_manager_id: sanitized.accountManagerId,
      notes: sanitized.notes,
      tags: sanitized.tags || [],
      contract_value: (sanitized as any).contractValue
    };

    const result = await getSql()`
      INSERT INTO clients (
        name, 
        email, 
        phone, 
        address, 
        city, 
        state, 
        postal_code,
        country, 
        type, 
        status,
        contact_person, 
        contact_email, 
        contact_phone,
        metadata,
        payment_terms,
        created_at, 
        updated_at
      ) VALUES (
        ${sanitized.name},
        ${sanitized.email || null},
        ${sanitized.phone || null},
        ${sanitized.address || null},
        ${sanitized.city || null},
        ${sanitized.province || null},
        ${sanitized.postalCode || null},
        ${sanitized.country || 'South Africa'},
        ${sanitized.industry || 'Other'},
        ${sanitized.status || 'ACTIVE'},
        ${sanitized.contactPerson || null},
        ${sanitized.email || null},
        ${sanitized.phone || null},
        ${JSON.stringify(metadata)},
        ${extractPaymentTerms(sanitized.paymentTerms)},
        NOW(),
        NOW()
      )
      RETURNING id
    `;
    
    const rows = result as any[];
    return rows[0].id;
  } catch (error) {
    log.error('Error creating client:', { data: error }, 'mutations');
    throw error;
  }
}

/**
 * Update an existing client
 */
export async function updateClient(id: string, data: Partial<ClientFormData>): Promise<void> {
  try {
    // Sanitize all text inputs to prevent XSS
    const sanitized = sanitizeClientData(data);
    
    // Build metadata update if needed
    const metadata = buildMetadata(sanitized);

    await getSql()`
      UPDATE clients
      SET 
        name = COALESCE(${sanitized.name}, name),
        email = COALESCE(${sanitized.email}, email),
        phone = COALESCE(${sanitized.phone}, phone),
        address = COALESCE(${sanitized.address}, address),
        city = COALESCE(${sanitized.city}, city),
        state = COALESCE(${sanitized.province}, state),
        postal_code = COALESCE(${sanitized.postalCode}, postal_code),
        country = COALESCE(${sanitized.country}, country),
        type = COALESCE(${sanitized.industry}, type),
        status = COALESCE(${sanitized.status}, status),
        contact_person = COALESCE(${sanitized.contactPerson}, contact_person),
        contact_email = COALESCE(${sanitized.email}, contact_email),
        contact_phone = COALESCE(${sanitized.phone}, contact_phone),
        metadata = COALESCE(${Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null}, metadata),
        payment_terms = COALESCE(${sanitized.paymentTerms ? extractPaymentTerms(sanitized.paymentTerms) : null}, payment_terms),
        updated_at = NOW()
      WHERE id = ${id}
    `;
  } catch (error) {
    log.error('Error updating client:', { data: error }, 'mutations');
    throw error;
  }
}

/**
 * Delete a client
 */
export async function deleteClient(id: string): Promise<void> {
  try {
    await getSql()`
      DELETE FROM clients
      WHERE id = ${id}
    `;
  } catch (error) {
    log.error('Error deleting client:', { data: error }, 'mutations');
    throw error;
  }
}
