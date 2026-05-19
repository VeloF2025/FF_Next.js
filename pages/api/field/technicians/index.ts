import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { withAuth } from '@/lib/auth';
import { createLoggedSql } from '@/lib/db-logger';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

// Initialize database connection with logging
const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === 'GET') {
    try {
      // Query staff who are field technicians
      const technicianData = await sql`
        SELECT 
          s.*,
          u.first_name as user_first_name,
          u.last_name as user_last_name,
          u.last_login,
          (
            SELECT COUNT(*) FROM tasks 
            WHERE tasks.assigned_to = s.user_id
            AND tasks.status IN ('pending', 'in_progress')
          )::int as active_task_count,
          (
            SELECT COUNT(*) FROM tasks 
            WHERE tasks.assigned_to = s.user_id
            AND tasks.status = 'completed'
          )::int as completed_task_count,
          (
            SELECT id FROM tasks 
            WHERE tasks.assigned_to = s.user_id
            AND tasks.status = 'in_progress'
            ORDER BY tasks.updated_at DESC
            LIMIT 1
          ) as current_task_id
        FROM staff s
        LEFT JOIN users u ON s.user_id = u.id
        WHERE (
          s.department = 'Field Operations' OR
          s.position = 'Field Technician' OR
          s.position = 'Technician'
        )
        ORDER BY s.updated_at DESC
        LIMIT 50
      `;
      
      // Transform data to match FieldTechnician format
      const transformedTechnicians = technicianData.map((s) => ({
        id: s.id,
        name: `${s.first_name} ${s.last_name}`,
        email: s.email,
        phone: s.phone || '+27 00 000 0000',
        status: determineStatus(s.status, s.active_task_count, s.current_task_id),
        currentTask: s.current_task_id || null,
        location: {
          lat: -26.2041, // Default location - could be enhanced with real GPS data
          lng: 28.0473
        },
        skills: Array.isArray(s.skills) ? s.skills : [],
        rating: s.performance_rating ? Number(s.performance_rating) : 4.0,
        completedTasks: s.completed_task_count || 0,
        activeTaskCount: s.active_task_count || 0,
        lastActive: s.last_login || s.updated_at || new Date().toISOString(),
        createdAt: s.created_at || new Date().toISOString(),
      }));
      
      // Calculate statistics
      const stats = {
        total: transformedTechnicians.length,
        available: transformedTechnicians.filter(t => t.status === 'available').length,
        onTask: transformedTechnicians.filter(t => t.status === 'on_task').length,
        onBreak: transformedTechnicians.filter(t => t.status === 'on_break').length,
        offline: transformedTechnicians.filter(t => t.status === 'offline').length,
        avgRating: transformedTechnicians.reduce((sum, t) => sum + t.rating, 0) / (transformedTechnicians.length || 1),
      };

      return apiResponse.success(res, { technicians: transformedTechnicians, ...stats });
    } catch (error) {
      log.error('Error fetching technicians', { error });
      apiResponse.internalError(res, new Error('Failed to fetch technicians'));
    }
  } else if (req.method === 'POST') {
    // POST is a deprecation shim that forwards to /api/field/users.
    // Normalises legacy body shape: { name: 'First Last' } → split into firstName/lastName.
    // role is forced to 'technician'.
    //
    // Response shape is translated back to legacy:
    //   201 success → { message: 'Technician added successfully', technician: <full staff row> }
    //   Any error   → forwarded verbatim (status + body unchanged)
    const incoming = req.body as {
      name?: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
      email?: string;
      contractorId?: string;
      [k: string]: unknown;
    };
    const [splitFirst, ...splitRest] = (incoming.name ?? '').trim().split(/\s+/);
    const forwardBody = {
      firstName: incoming.firstName ?? splitFirst ?? '',
      lastName: incoming.lastName ?? splitRest.join(' ') ?? '',
      email: incoming.email,
      phone: incoming.phone,
      role: 'technician' as const,
      contractorId: incoming.contractorId,
    };

    // Build a response interceptor to capture what usersHandler would emit
    // without touching the real `res` object.
    let capturedStatus = 500;
    let capturedBody: unknown = null;
    const interceptor = {
      status(code: number) {
        capturedStatus = code;
        return this;
      },
      json(body: unknown) {
        capturedBody = body;
        return this;
      },
      setHeader: res.setHeader.bind(res),
    } as unknown as typeof res;

    const usersHandler = (await import('@/pages/api/field/users/index')).default;
    (req as unknown as { body: unknown }).body = forwardBody;
    await usersHandler(req, interceptor);

    // Translate 201 success to the legacy response shape.
    // Any other status (4xx, 5xx) is forwarded as-is so callers see real errors.
    const body201 = capturedBody as { data?: { user?: { id?: string } } } | null;
    if (capturedStatus === 201 && body201?.data?.user?.id) {
      const newId = body201.data.user.id;
      try {
        // ── H6 (blind review 2026-05-19): Explicit column projection ───────────
        // Previously used SELECT * which exposes columns added by later migrations
        // (e.g. role, account_status, created_by_staff_id from migration 346).
        // We project only the columns that existed in the original pre-shim
        // INSERT … RETURNING * surface: the nine INSERT columns plus id,
        // created_at, updated_at. This preserves the legacy response contract
        // without leaking newer additions to this public-facing shim endpoint.
        // ────────────────────────────────────────────────────────────────────────
        const rows = await sql`
          SELECT
            id,
            employee_id,
            first_name,
            last_name,
            email,
            phone,
            department,
            position,
            status,
            contract_type,
            created_at,
            updated_at
          FROM staff
          WHERE id = ${newId}
          LIMIT 1
        `;
        const technician = rows[0] ?? null;
        // ── H1 (blind review 2026-05-19): LEGACY_RESPONSE_SHAPE ─────────────
        // This POST path is a backward-compatibility shim. Its callers expect:
        //   201  { message: 'Technician added successfully', technician: <row> }
        // Using apiResponse.created() would emit { success:true, data:..., message }
        // which breaks the contract. There is no apiResponse.raw() escape hatch.
        // Decision: preserve raw JSON here and document the deviation. This shim
        // exists specifically to bridge legacy callers — contract > strict convention.
        // ────────────────────────────────────────────────────────────────────────
        res.status(201).json({ message: 'Technician added successfully', technician });
      } catch (dbErr) {
        log.error('Failed to fetch full staff row after technician create', { error: dbErr }, 'TechniciansShim');
        // Fall through: still surface the 201 with whatever we have
        res.status(201).json({ message: 'Technician added successfully', technician: body201.data.user });
      }
      return;
    }

    // Non-201 or unexpected shape: forward verbatim
    res.status(capturedStatus).json(capturedBody);
    return;
  } else {
    apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
  }
}))

// Helper function to determine technician status
function determineStatus(
  staffStatus: string | null,
  activeTaskCount: number,
  currentTaskId: string | null
): 'available' | 'on_task' | 'on_break' | 'offline' {
  if (staffStatus === 'inactive' || staffStatus === 'terminated') return 'offline';
  if (currentTaskId) return 'on_task';
  if (activeTaskCount > 0) return 'on_task';
  if (staffStatus === 'on_leave') return 'on_break';
  return 'available';
}