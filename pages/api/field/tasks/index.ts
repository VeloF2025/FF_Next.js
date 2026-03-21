import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';import type { FieldTask } from '../../../../src/modules/field-app/types/field-app.types';
import { withErrorHandler } from '@/lib/api-error-handler';
import { withAuth } from '@/lib/auth';
import { createLoggedSql, logCreate, logUpdate, logDelete } from '@/lib/db-logger';
import { apiResponse, ErrorCode } from '../../../../src/lib/apiResponse';

// Initialize database connection with logging
const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === 'GET') {
    try {
      const { 
        technicianId, 
        status, 
        priority, 
        dateFrom, 
        dateTo,
        category,
        search,
        limit = '100',
        offset = '0'
      } = req.query;
      
      // Build dynamic query based on filters
      let taskData;
      
      if (technicianId || status || priority || category || dateFrom || dateTo || search) {
        // Build parameterized query for filters
        const conditions: string[] = [];
        const params: (string | Date)[] = [];
        let paramIndex = 1;

        if (technicianId) {
          conditions.push(`t.assigned_to = $${paramIndex++}`);
          params.push(technicianId as string);
        }
        if (status) {
          conditions.push(`t.status = $${paramIndex++}`);
          params.push(status as string);
        }
        if (priority) {
          conditions.push(`t.priority = $${paramIndex++}`);
          params.push(priority as string);
        }
        if (category) {
          conditions.push(`t.category = $${paramIndex++}`);
          params.push(category as string);
        }
        if (dateFrom) {
          conditions.push(`t.due_date >= $${paramIndex++}`);
          params.push(new Date(dateFrom as string).toISOString());
        }
        if (dateTo) {
          conditions.push(`t.due_date <= $${paramIndex++}`);
          params.push(new Date(dateTo as string).toISOString());
        }
        if (search) {
          const searchParam = `%${search}%`;
          conditions.push(`(t.title ILIKE $${paramIndex} OR t.description ILIKE $${paramIndex})`);
          paramIndex++;
          params.push(searchParam);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limitParam = paramIndex++;
        const offsetParam = paramIndex++;
        params.push(String(Number(limit)) as any, String(Number(offset)) as any);

        const baseQuery = `
          SELECT
            t.*,
            u.first_name,
            u.last_name,
            p.project_name,
            p.location as project_location
          FROM tasks t
          LEFT JOIN users u ON t.assigned_to = u.id
          LEFT JOIN projects p ON t.project_id = p.id
          ${whereClause}
          ORDER BY
            CASE t.priority
              WHEN 'urgent' THEN 1
              WHEN 'high' THEN 2
              WHEN 'medium' THEN 3
              WHEN 'low' THEN 4
              ELSE 5
            END,
            t.created_at DESC
          LIMIT $${limitParam}
          OFFSET $${offsetParam}
        `;

        taskData = await sql.unsafe(baseQuery, params);
      } else {
        // Simple query without filters
        taskData = await sql`
          SELECT 
            t.*,
            u.first_name,
            u.last_name,
            p.project_name,
            p.location as project_location
          FROM tasks t
          LEFT JOIN users u ON t.assigned_to = u.id
          LEFT JOIN projects p ON t.project_id = p.id
          ORDER BY 
            CASE t.priority 
              WHEN 'urgent' THEN 1 
              WHEN 'high' THEN 2 
              WHEN 'medium' THEN 3 
              WHEN 'low' THEN 4 
              ELSE 5 
            END,
            t.created_at DESC
          LIMIT ${Number(limit)}
          OFFSET ${Number(offset)}
        `;
      }
      
      // Transform data to match FieldTask format
      const transformedTasks: FieldTask[] = taskData.map((task) => {
        const metadata = task.metadata as any || {};
        const location = metadata.location || {};
        
        return {
          id: task.id,
          title: task.title,
          description: task.description || '',
          type: task.category as 'installation' | 'maintenance' | 'inspection' || 'installation',
          priority: task.priority as 'low' | 'medium' | 'high' | 'urgent' || 'medium',
          status: task.status as 'pending' | 'in_progress' | 'completed' | 'cancelled' || 'pending',
          assignedTo: task.assigned_to || '',
          technicianName: task.first_name && task.last_name ? `${task.first_name} ${task.last_name}`.trim() : 'Unassigned',
          location: {
            address: location.address || task.project_location || 'No address specified',
            coordinates: location.latitude && location.longitude ? {
              lat: Number(location.latitude),
              lng: Number(location.longitude)
            } : { lat: -26.2041, lng: 28.0473 } // Default to Johannesburg
          },
          scheduledDate: task.start_date || task.due_date || new Date().toISOString(),
          estimatedDuration: task.estimated_hours ? Number(task.estimated_hours) : 4,
          materials: metadata.equipment || [],
          syncStatus: metadata.syncStatus || 'synced' as const,
          offline: metadata.offlineEdits ? true : false,
          notes: metadata.notes,
          photos: metadata.photos || [],
          customerInfo: metadata.customerInfo,
          workOrder: metadata.workOrder,
          qualityCheck: metadata.qualityCheck,
          createdAt: task.created_at || new Date().toISOString(),
          updatedAt: task.updated_at || new Date().toISOString(),
        };
      });
      
      // Add statistics
      const stats = {
        totalTasks: transformedTasks.length,
        pendingTasks: transformedTasks.filter(t => t.status === 'pending').length,
        inProgressTasks: transformedTasks.filter(t => t.status === 'in_progress').length,
        completedTasks: transformedTasks.filter(t => t.status === 'completed').length,
        highPriorityTasks: transformedTasks.filter(t => t.priority === 'high' || t.priority === 'urgent').length,
      };

      // Return paginated response
      const page = Number(req.query.page) || 1;
      const pageSize = Number(limit);
      
      return apiResponse.paginated(
        res,
        transformedTasks,
        {
          page,
          pageSize,
          total: transformedTasks.length + Number(offset), // Estimate total based on current results
        },
        undefined,
        { stats }
      );
    } catch (error) {
      log.error('tasks-index', { error: error instanceof Error ? error.message : String(error) });
      return apiResponse.databaseError(res, error, 'Failed to fetch tasks');
    }
  } else if (req.method === 'POST') {
    try {
      const newTask = req.body;
      
      // Generate task code if not provided
      const taskCode = newTask.taskCode || `TASK-${Date.now().toString().slice(-8)}`;
      
      // Insert new task into database
      const insertedTasks = await sql`
        INSERT INTO tasks (
          task_code, title, description, status, priority,
          category, assigned_to, project_id, due_date,
          estimated_hours, metadata
        )
        VALUES (
          ${taskCode},
          ${newTask.title},
          ${newTask.description || ''},
          ${newTask.status || 'pending'},
          ${newTask.priority || 'medium'},
          ${newTask.type || newTask.category || 'installation'},
          ${newTask.assignedTo || null},
          ${newTask.projectId || null},
          ${newTask.scheduledDate ? new Date(newTask.scheduledDate) : null},
          ${newTask.estimatedDuration || 4},
          ${JSON.stringify(newTask.metadata || {})}
        )
        RETURNING *
      `;
      
      // Log task creation
      if (insertedTasks[0]) {
        logCreate('field_task', insertedTasks[0].id, {
          task_code: insertedTasks[0].task_code,
          title: insertedTasks[0].title,
          assigned_to: insertedTasks[0].assigned_to,
          project_id: insertedTasks[0].project_id,
          priority: insertedTasks[0].priority
        });
      }
      
      return apiResponse.created(
        res,
        insertedTasks[0],
        'Task created successfully'
      );
    } catch (error) {
      return apiResponse.databaseError(res, error, 'Failed to create task');
    }
  } else {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
  }
}));