// SQL Helper Functions - Typed wrappers for common database queries
// Uses the existing Neon SQL configuration from lib/db.js

import { sql, query as dbQuery } from './pool.js';
import type {
  Project,
  Client,
  Staff,
  Contractor,
  BOQ,
  RFQ,
  PurchaseOrder,
  Supplier,
  SOWPole,
  SOWDrop,
  SOWFibre,
  Document,
  QueryResult,
  SingleResult,
  PaginatedResult,
  QueryOptions,
  FilterOptions,
  ProjectAnalytics,
  ClientAnalytics,
  StaffPerformance,
  KpiMetrics,
  AuditLog
} from './types';

// ============================================
// ALLOWLISTS FOR DYNAMIC IDENTIFIERS
// ============================================

const VALID_TABLES = new Set([
  'clients', 'projects', 'staff', 'contractors', 'boqs', 'rfqs',
  'purchase_orders', 'suppliers', 'sow_poles', 'sow_drops', 'sow_fibre',
  'documents', 'audit_log', 'kpi_metrics', 'project_analytics',
  'client_analytics', 'staff_performance',
]);

const VALID_ORDER_COLUMNS = new Set([
  'created_at', 'updated_at', 'company_name', 'last_name', 'first_name',
  'name', 'status', 'pole_number', 'drop_number', 'section_id',
  'recorded_date', 'timestamp', 'uploaded_at', 'period_start',
]);

const VALID_DIRECTIONS = new Set(['ASC', 'DESC']);

function assertValidTable(table: string): void {
  if (!VALID_TABLES.has(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }
}

function safeOrderBy(col: string): string {
  return VALID_ORDER_COLUMNS.has(col) ? col : 'created_at';
}

function safeDirection(dir: string): 'ASC' | 'DESC' {
  const upper = dir.toUpperCase();
  return VALID_DIRECTIONS.has(upper) ? upper as 'ASC' | 'DESC' : 'DESC';
}

// ============================================
// GENERIC HELPERS
// ============================================

export async function getById<T>(table: string, id: string): Promise<SingleResult<T>> {
  assertValidTable(table);
  const result = await sql`
    SELECT * FROM ${sql.unsafe(table)}
    WHERE id = ${id}
    LIMIT 1
  `;
  return (result as Record<string, unknown>[])[0] as T || null;
}

export async function deleteById(table: string, id: string): Promise<boolean> {
  assertValidTable(table);
  const result = await sql`
    DELETE FROM ${sql.unsafe(table)}
    WHERE id = ${id}
  `;
  return (result as unknown as { count: number }).count > 0;
}

export async function count(table: string, filters?: FilterOptions): Promise<number> {
  assertValidTable(table);
  let query = `SELECT COUNT(*) as count FROM ${table}`;

  if (filters && Object.keys(filters).length > 0) {
    const conditions = Object.entries(filters)
      .filter(([_, value]) => value !== undefined && value !== null)
      .map(([key, _], index) => `${key} = $${index + 1}`);

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
  }

  const values = filters ? Object.values(filters).filter(v => v !== undefined && v !== null) : [];
  const result = await dbQuery(query, values);
  return (result as any[])[0]?.count || 0;
}

// ============================================
// CLIENT QUERIES
// ============================================

export async function getClients(options?: QueryOptions): Promise<QueryResult<Client>> {
  const limit = options?.limit || 100;
  const offset = options?.offset || 0;
  const orderBy = safeOrderBy(options?.orderBy || 'created_at');
  const orderDirection = safeDirection(options?.orderDirection || 'DESC');

  return await sql`
    SELECT * FROM clients
    ORDER BY ${sql.unsafe(orderBy)} ${sql.unsafe(orderDirection)}
    LIMIT ${limit}
    OFFSET ${offset}
  ` as QueryResult<Client>;
}

export async function getClientById(id: string): Promise<SingleResult<Client>> {
  const result = await sql`
    SELECT * FROM clients 
    WHERE id = ${id} 
    LIMIT 1
  `;
  return (result as any[])[0] as Client || null;
}

export async function createClient(client: Partial<Client>): Promise<Client> {
  const result = await sql`
    INSERT INTO clients (
      company_name, contact_person, email, phone, address, 
      city, province, postal_code, country, industry,
      website, tax_number, registration_number, payment_terms,
      credit_limit, account_status, notes, created_by
    ) VALUES (
      ${client.company_name}, ${client.contact_person}, ${client.email},
      ${client.phone}, ${client.address}, ${client.city},
      ${client.province}, ${client.postal_code}, ${client.country},
      ${client.industry}, ${client.website}, ${client.tax_number},
      ${client.registration_number}, ${client.payment_terms},
      ${client.credit_limit}, ${client.account_status || 'active'},
      ${client.notes}, ${client.created_by}
    )
    RETURNING *
  `;
  return (result as any[])[0] as Client;
}

export async function updateClient(id: string, updates: Partial<Client>): Promise<SingleResult<Client>> {
  const fields = Object.keys(updates).filter(k => k !== 'id' && k !== 'created_at');
  if (fields.length === 0) return null;
  const safeFields = fields.filter(f => /^[a-z_][a-z0-9_]*$/.test(f));
  const setClause = safeFields.map((field, i) => `"${field}" = $${i + 2}`).join(', ');
  const values = [id, ...safeFields.map(f => updates[f as keyof Client])];

  const updateQuery = `
    UPDATE clients
    SET ${setClause}, updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `;

  const result = await dbQuery(updateQuery, values);
  return (result as any[])[0] as Client || null;
}

// ============================================
// PROJECT QUERIES
// ============================================

export async function getProjects(options?: QueryOptions): Promise<QueryResult<Project>> {
  const limit = options?.limit || 100;
  const offset = options?.offset || 0;
  
  return await sql`
    SELECT * FROM projects
    ORDER BY created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  ` as QueryResult<Project>;
}

export async function getProjectById(id: string): Promise<SingleResult<Project>> {
  const result = await sql`
    SELECT * FROM projects 
    WHERE id = ${id} 
    LIMIT 1
  `;
  return (result as any[])[0] as Project || null;
}

export async function getProjectsByClientId(clientId: string): Promise<QueryResult<Project>> {
  return await sql`
    SELECT * FROM projects
    WHERE client_id = ${clientId}
    ORDER BY created_at DESC
  ` as QueryResult<Project>;
}

export async function createProject(project: Partial<Project>): Promise<Project> {
  const result = await sql`
    INSERT INTO projects (
      project_number, name, description, client_id, project_type,
      status, priority, start_date, end_date, budget,
      location, gps_coordinates, project_manager, technical_lead,
      site_supervisor, metadata, created_by
    ) VALUES (
      ${project.project_number}, ${project.name}, ${project.description},
      ${project.client_id}, ${project.project_type}, ${project.status || 'planning'},
      ${project.priority}, ${project.start_date}, ${project.end_date},
      ${project.budget}, ${project.location}, ${project.gps_coordinates},
      ${project.project_manager}, ${project.technical_lead},
      ${project.site_supervisor}, ${project.metadata}, ${project.created_by}
    )
    RETURNING *
  `;
  return (result as any[])[0] as Project;
}

export async function updateProject(id: string, updates: Partial<Project>): Promise<SingleResult<Project>> {
  const fields = Object.keys(updates).filter(k => k !== 'id' && k !== 'created_at');
  if (fields.length === 0) return null;
  const safeFields = fields.filter(f => /^[a-z_][a-z0-9_]*$/.test(f));
  const setClause = safeFields.map((field, i) => `"${field}" = $${i + 2}`).join(', ');
  const values = [id, ...safeFields.map(f => updates[f as keyof Project])];

  const updateQuery = `
    UPDATE projects
    SET ${setClause}, updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `;

  const result = await dbQuery(updateQuery, values);
  return (result as any[])[0] as Project || null;
}

// ============================================
// STAFF QUERIES
// ============================================

export async function getStaff(options?: QueryOptions): Promise<QueryResult<Staff>> {
  const limit = options?.limit || 100;
  const offset = options?.offset || 0;
  
  return await sql`
    SELECT * FROM staff
    WHERE status = 'active'
    ORDER BY last_name, first_name
    LIMIT ${limit}
    OFFSET ${offset}
  ` as QueryResult<Staff>;
}

export async function getStaffById(id: string): Promise<SingleResult<Staff>> {
  const result = await sql`
    SELECT * FROM staff 
    WHERE id = ${id} 
    LIMIT 1
  `;
  return (result as any[])[0] as Staff || null;
}

export async function getStaffByDepartment(department: string): Promise<QueryResult<Staff>> {
  return await sql`
    SELECT * FROM staff
    WHERE department = ${department} AND status = 'active'
    ORDER BY last_name, first_name
  ` as QueryResult<Staff>;
}

export async function createStaff(staff: Partial<Staff>): Promise<Staff> {
  const result = await sql`
    INSERT INTO staff (
      employee_id, first_name, last_name, email, phone,
      department, position, role, status, hire_date,
      birth_date, id_number, address, emergency_contact,
      emergency_phone, skills, certifications, manager_id, created_by
    ) VALUES (
      ${staff.employee_id}, ${staff.first_name}, ${staff.last_name},
      ${staff.email}, ${staff.phone}, ${staff.department},
      ${staff.position}, ${staff.role}, ${staff.status || 'active'},
      ${staff.hire_date}, ${staff.birth_date}, ${staff.id_number},
      ${staff.address}, ${staff.emergency_contact}, ${staff.emergency_phone},
      ${staff.skills}, ${staff.certifications}, ${staff.manager_id}, ${staff.created_by}
    )
    RETURNING *
  `;
  return (result as any[])[0] as Staff;
}

// ============================================
// SOW QUERIES (POLES, DROPS, FIBRE)
// ============================================

export async function getSOWPolesByProject(projectId: string): Promise<QueryResult<SOWPole>> {
  return await sql`
    SELECT * FROM sow_poles
    WHERE project_id = ${projectId}
    ORDER BY pole_number
  ` as QueryResult<SOWPole>;
}

export async function getSOWDropsByProject(projectId: string): Promise<QueryResult<SOWDrop>> {
  return await sql`
    SELECT * FROM sow_drops
    WHERE project_id = ${projectId}
    ORDER BY drop_number
  ` as QueryResult<SOWDrop>;
}

export async function getSOWFibreByProject(projectId: string): Promise<QueryResult<SOWFibre>> {
  return await sql`
    SELECT * FROM sow_fibre
    WHERE project_id = ${projectId}
    ORDER BY section_id
  ` as QueryResult<SOWFibre>;
}

export async function updateSOWPoleStatus(id: string, status: string): Promise<boolean> {
  const result = await sql`
    UPDATE sow_poles
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${id}
  `;
  return (result as unknown as { count: number }).count > 0;
}

export async function updateSOWDropStatus(id: string, status: string): Promise<boolean> {
  const result = await sql`
    UPDATE sow_drops
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${id}
  `;
  return (result as unknown as { count: number }).count > 0;
}

// ============================================
// CONTRACTOR QUERIES
// ============================================

export async function getContractors(options?: QueryOptions): Promise<QueryResult<Contractor>> {
  const limit = options?.limit || 100;
  const offset = options?.offset || 0;
  
  return await sql`
    SELECT * FROM contractors
    WHERE status = 'active'
    ORDER BY company_name
    LIMIT ${limit}
    OFFSET ${offset}
  ` as QueryResult<Contractor>;
}

export async function getContractorById(id: string): Promise<SingleResult<Contractor>> {
  const result = await sql`
    SELECT * FROM contractors 
    WHERE id = ${id} 
    LIMIT 1
  `;
  return (result as any[])[0] as Contractor || null;
}

export async function getContractorsByRAGStatus(ragStatus: string): Promise<QueryResult<Contractor>> {
  return await sql`
    SELECT * FROM contractors
    WHERE rag_status = ${ragStatus} AND status = 'active'
    ORDER BY rag_score DESC, company_name
  ` as QueryResult<Contractor>;
}

// ============================================
// PROCUREMENT QUERIES (BOQ, RFQ, PO)
// ============================================

export async function getBOQsByProject(projectId: string): Promise<QueryResult<BOQ>> {
  return await sql`
    SELECT * FROM boqs
    WHERE project_id = ${projectId}
    ORDER BY created_at DESC
  ` as QueryResult<BOQ>;
}

export async function getRFQs(status?: string): Promise<QueryResult<RFQ>> {
  if (status) {
    return await sql`
      SELECT * FROM rfqs
      WHERE status = ${status}
      ORDER BY submission_deadline ASC
    ` as QueryResult<RFQ>;
  }
  
  return await sql`
    SELECT * FROM rfqs
    ORDER BY created_at DESC
  ` as QueryResult<RFQ>;
}

export async function getPurchaseOrders(supplierId?: string): Promise<QueryResult<PurchaseOrder>> {
  if (supplierId) {
    return await sql`
      SELECT * FROM purchase_orders
      WHERE supplier_id = ${supplierId}
      ORDER BY created_at DESC
    ` as QueryResult<PurchaseOrder>;
  }
  
  return await sql`
    SELECT * FROM purchase_orders
    ORDER BY created_at DESC
  ` as QueryResult<PurchaseOrder>;
}

export async function getSuppliers(category?: string): Promise<QueryResult<Supplier>> {
  if (category) {
    return await sql`
      SELECT * FROM suppliers
      WHERE category = ${category} AND status = 'active'
      ORDER BY company_name
    ` as QueryResult<Supplier>;
  }
  
  return await sql`
    SELECT * FROM suppliers
    WHERE status = 'active'
    ORDER BY company_name
  ` as QueryResult<Supplier>;
}

// ============================================
// ANALYTICS QUERIES
// ============================================

export async function getProjectAnalytics(projectId: string): Promise<SingleResult<ProjectAnalytics>> {
  const result = await sql`
    SELECT * FROM project_analytics
    WHERE project_id = ${projectId}
    LIMIT 1
  ` as any[];
  return result[0] as ProjectAnalytics || null;
}

export async function getClientAnalytics(clientId: string): Promise<SingleResult<ClientAnalytics>> {
  const result = await sql`
    SELECT * FROM client_analytics
    WHERE client_id = ${clientId}
    LIMIT 1
  ` as any[];
  return result[0] as ClientAnalytics || null;
}

export async function getStaffPerformance(
  staffId: string, 
  startDate: Date, 
  endDate: Date
): Promise<QueryResult<StaffPerformance>> {
  return await sql`
    SELECT * FROM staff_performance
    WHERE staff_id = ${staffId}
      AND period_start >= ${startDate}
      AND period_end <= ${endDate}
    ORDER BY period_start DESC
  ` as QueryResult<StaffPerformance>;
}

export async function getKPIMetrics(
  projectId?: string,
  metricType?: string,
  startDate?: Date
): Promise<QueryResult<KpiMetrics>> {
  const conditions = [];
  const values = [];
  let paramIndex = 1;
  
  if (projectId) {
    conditions.push(`project_id = $${paramIndex++}`);
    values.push(projectId);
  }
  
  if (metricType) {
    conditions.push(`metric_type = $${paramIndex++}`);
    values.push(metricType);
  }
  
  if (startDate) {
    conditions.push(`recorded_date >= $${paramIndex++}`);
    values.push(startDate);
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `
    SELECT * FROM kpi_metrics
    ${whereClause}
    ORDER BY recorded_date DESC
    LIMIT 1000
  `;
  
  return await dbQuery(query, values) as QueryResult<KpiMetrics>;
}

// ============================================
// AUDIT LOG QUERIES
// ============================================

export async function createAuditLog(log: Partial<AuditLog>): Promise<void> {
  await sql`
    INSERT INTO audit_log (
      action, entity_type, entity_id, user_id, user_name,
      user_role, ip_address, user_agent, old_value, new_value,
      changes_summary, session_id, source
    ) VALUES (
      ${log.action}, ${log.entity_type}, ${log.entity_id},
      ${log.user_id}, ${log.user_name}, ${log.user_role},
      ${log.ip_address}, ${log.user_agent}, ${log.old_value},
      ${log.new_value}, ${log.changes_summary}, ${log.session_id}, ${log.source}
    )
  `;
}

export async function getAuditLogs(
  entityType: string,
  entityId: string,
  limit: number = 50
): Promise<QueryResult<AuditLog>> {
  return await sql`
    SELECT * FROM audit_log
    WHERE entity_type = ${entityType} AND entity_id = ${entityId}
    ORDER BY timestamp DESC
    LIMIT ${limit}
  ` as QueryResult<AuditLog>;
}

// ============================================
// DOCUMENT QUERIES
// ============================================

export async function getDocumentsByEntity(
  entityType: string,
  entityId: string
): Promise<QueryResult<Document>> {
  return await sql`
    SELECT * FROM documents
    WHERE entity_type = ${entityType} AND entity_id = ${entityId}
    ORDER BY uploaded_at DESC
  ` as QueryResult<Document>;
}

export async function createDocument(doc: Partial<Document>): Promise<Document> {
  const result = await sql`
    INSERT INTO documents (
      entity_type, entity_id, document_type, file_name,
      file_path, file_size, mime_type, description,
      version, uploaded_by, status, metadata
    ) VALUES (
      ${doc.entity_type}, ${doc.entity_id}, ${doc.document_type},
      ${doc.file_name}, ${doc.file_path}, ${doc.file_size},
      ${doc.mime_type}, ${doc.description}, ${doc.version},
      ${doc.uploaded_by}, ${doc.status || 'active'}, ${doc.metadata}
    )
    RETURNING *
  ` as any[];
  return result[0] as Document;
}

// ============================================
// PAGINATION HELPER
// ============================================

export async function getPaginated<T>(
  table: string,
  page: number = 1,
  pageSize: number = 20,
  filters?: FilterOptions,
  orderBy: string = 'created_at',
  orderDirection: 'ASC' | 'DESC' = 'DESC'
): Promise<PaginatedResult<T>> {
  assertValidTable(table);
  const safeOrder = safeOrderBy(orderBy);
  const safeDir = safeDirection(orderDirection);
  const offset = (page - 1) * pageSize;

  let whereClause = '';
  let values: any[] = [];
  let paramIndex = 1;

  if (filters && Object.keys(filters).length > 0) {
    const conditions = Object.entries(filters)
      .filter(([key, value]) => value !== undefined && value !== null && /^[a-z_][a-z0-9_]*$/.test(key))
      .map(([key, _]) => {
        return `"${key}" = $${paramIndex++}`;
      });

    if (conditions.length > 0) {
      whereClause = `WHERE ${conditions.join(' AND ')}`;
      values = Object.entries(filters)
        .filter(([key, v]) => v !== undefined && v !== null && /^[a-z_][a-z0-9_]*$/.test(key))
        .map(([_, v]) => v);
    }
  }

  const countQuery = `SELECT COUNT(*) as total FROM ${table} ${whereClause}`;
  const countResult = await dbQuery(countQuery, values) as any[];
  const total = countResult[0]?.total || 0;

  values.push(pageSize, offset);
  const dataQuery = `
    SELECT * FROM ${table}
    ${whereClause}
    ORDER BY ${safeOrder} ${safeDir}
    LIMIT $${paramIndex++}
    OFFSET $${paramIndex}
  `;

  const data = await dbQuery(dataQuery, values) as T[];

  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  };
}

// ============================================
// TRANSACTION HELPER
// ============================================

export { transaction } from './pool.js';

// ============================================
// RAW QUERY HELPER (for complex queries)
// ============================================

export async function rawQuery<T>(query: string, values?: any[]): Promise<QueryResult<T>> {
  return await dbQuery(query, values) as QueryResult<T>;
}

// Export the sql template tag for direct use when needed
export { sql } from './pool.js';