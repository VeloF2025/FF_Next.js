/**
 * WhatsApp Template by Key API
 * GET  /api/communications/whatsapp/templates/[key] - Get a template
 * PUT  /api/communications/whatsapp/templates/[key] - Update a template
 * POST /api/communications/whatsapp/templates/[key]/preview - Preview with sample data
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse } from '@/lib/apiResponse';
import type {
  WaMessageTemplate,
  WaMessageTemplateInput,
  WaAdminApiResponse
} from '@/modules/communications/whatsapp/types/wa-admin.types';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaMessageTemplate | { preview: string }>>
) {
  const { key } = req.query;

  if (!key || typeof key !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Template key is required',
    });
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(key, res);
      case 'PUT':
        return handlePut(key, req, res);
      case 'POST':
        // Handle preview
        return handlePreview(key, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PUT', 'POST']);
    }
  } catch (error) {
    console.error('[WA Template API] Error:', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * GET - Get a single template by key
 */
async function handleGet(
  key: string,
  res: NextApiResponse<WaAdminApiResponse<WaMessageTemplate>>
) {
  const result = await pool.query(
    `SELECT
      id, template_key, template_name, template_content, variables,
      category, enabled, is_default, created_at, updated_at
    FROM wa_message_templates
    WHERE template_key = $1`,
    [key]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: 'Template not found',
    });
  }

  const template = result.rows[0] as WaMessageTemplate;

  return res.status(200).json({
    success: true,
    data: {
      ...template,
      variables: Array.isArray(template.variables)
        ? template.variables
        : JSON.parse(template.variables as unknown as string || '[]'),
    },
  });
}

/**
 * PUT - Update a template
 */
async function handlePut(
  key: string,
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaMessageTemplate>>
) {
  const input = req.body as WaMessageTemplateInput;

  // Get existing template first
  const existing = await pool.query(
    'SELECT * FROM wa_message_templates WHERE template_key = $1',
    [key]
  );

  if (existing.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: 'Template not found',
    });
  }

  const oldTemplate = existing.rows[0] as WaMessageTemplate;

  // Validate required fields
  if (input.template_content !== undefined && !input.template_content.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Template content cannot be empty',
    });
  }

  // Update the template
  const result = await pool.query(
    `UPDATE wa_message_templates SET
      template_name = COALESCE($1, template_name),
      template_content = COALESCE($2, template_content),
      variables = COALESCE($3::jsonb, variables),
      category = COALESCE($4, category),
      enabled = COALESCE($5, enabled),
      updated_at = NOW()
    WHERE template_key = $6
    RETURNING id, template_key, template_name, template_content, variables, category, enabled, is_default, created_at, updated_at`,
    [
      input.template_name ?? null,
      input.template_content ?? null,
      input.variables ? JSON.stringify(input.variables) : null,
      input.category ?? null,
      input.enabled ?? null,
      key,
    ]
  );

  const updatedTemplate = result.rows[0] as WaMessageTemplate;

  // Log admin action
  await logAdminAction('update_template', 'template', key, oldTemplate, updatedTemplate, req);

  return res.status(200).json({
    success: true,
    data: {
      ...updatedTemplate,
      variables: Array.isArray(updatedTemplate.variables)
        ? updatedTemplate.variables
        : JSON.parse(updatedTemplate.variables as unknown as string || '[]'),
    },
    message: `Template "${updatedTemplate.template_name}" updated successfully`,
  });
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sanitize preview value to prevent injection and limit length
 */
function sanitizePreviewValue(value: unknown, maxLength = 1000): string {
  if (typeof value !== 'string') {
    return String(value ?? '');
  }
  // Truncate long values and remove potential control characters
  return value.slice(0, maxLength).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/**
 * POST - Preview template with sample data
 */
async function handlePreview(
  key: string,
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<{ preview: string }>>
) {
  const sampleData = req.body as Record<string, unknown>;

  // Validate sampleData is an object
  if (!sampleData || typeof sampleData !== 'object' || Array.isArray(sampleData)) {
    return res.status(400).json({
      success: false,
      error: 'Sample data must be a valid object',
    });
  }

  // Get the template
  const result = await pool.query(
    `SELECT template_content, variables
    FROM wa_message_templates
    WHERE template_key = $1`,
    [key]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: 'Template not found',
    });
  }

  const template = result.rows[0];
  let preview = template.template_content as string;

  // Replace variables with sample data or placeholder
  const variables = Array.isArray(template.variables)
    ? template.variables
    : JSON.parse(template.variables as string || '[]');

  for (const variable of variables) {
    // Only allow alphanumeric variable names to prevent regex injection
    if (typeof variable !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(variable)) {
      continue;
    }
    const rawValue = sampleData[variable];
    const value = rawValue !== undefined ? sanitizePreviewValue(rawValue) : `[${variable}]`;
    // Use escaped regex pattern for safety
    const pattern = new RegExp(escapeRegex(`{{${variable}}}`), 'g');
    preview = preview.replace(pattern, value);
  }

  // Handle Handlebars-style conditionals (basic support)
  // {{#if condition}}...{{/if}}
  preview = preview.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, condition, content) => {
    return sampleData[condition] ? content : '';
  });

  // {{#each items}}...{{/each}} - simplified
  preview = preview.replace(/\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (match, arrayName, content) => {
    const items = sampleData[arrayName];
    if (Array.isArray(items)) {
      return items.slice(0, 100).map(item => content.replace(/\{\{this\}\}/g, sanitizePreviewValue(item))).join('\n');
    }
    return `[${arrayName} items]`;
  });

  return res.status(200).json({
    success: true,
    data: { preview },
  });
}

/**
 * Log admin action to audit table
 */
async function logAdminAction(
  action: string,
  entityType: string,
  entityId: string | null,
  oldValue: unknown,
  newValue: unknown,
  req: NextApiRequest
) {
  try {
    const userEmail = req.headers['x-user-email'] as string || null;
    const ipAddress = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || null;

    await pool.query(
      `INSERT INTO wa_admin_audit_log (
        action, entity_type, entity_id, old_value, new_value, user_email, ip_address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        action,
        entityType,
        entityId,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        userEmail,
        typeof ipAddress === 'string' ? ipAddress.split(',')[0] : ipAddress,
      ]
    );
  } catch (error) {
    console.error('[WA Admin] Failed to log audit action:', error);
  }
}
