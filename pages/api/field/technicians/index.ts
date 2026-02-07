import type { NextApiRequest, NextApiResponse } from 'next';
import type { FieldTechnician } from '../../../../src/modules/field-app/types/field-app.types';
import { withErrorHandler } from '@/lib/api-error-handler';
import { withAuth } from '@/lib/auth';
import { createLoggedSql, logCreate, logUpdate } from '@/lib/db-logger';
import { log } from '@/lib/logger';

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
      const transformedTechnicians: FieldTechnician[] = technicianData.map((s) => ({
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

      res.status(200).json({ 
        technicians: transformedTechnicians,
        ...stats
      });
    } catch (error) {
      log.error('Error fetching technicians', { error });
      res.status(500).json({ error: 'Failed to fetch technicians' });
    }
  } else if (req.method === 'POST') {
    try {
      const newTechnician = req.body;
      
      // Generate employee ID if not provided
      const employeeId = newTechnician.employeeId || `TECH-${Date.now().toString().slice(-8)}`;
      
      // Insert new staff member as technician
      const insertedStaff = await sql`
        INSERT INTO staff (
          employee_id, first_name, last_name, email, phone,
          department, position, status, contract_type
        )
        VALUES (
          ${employeeId},
          ${newTechnician.firstName || newTechnician.name?.split(' ')[0] || ''},
          ${newTechnician.lastName || newTechnician.name?.split(' ')[1] || ''},
          ${newTechnician.email},
          ${newTechnician.phone},
          'Field Operations',
          'Field Technician',
          'active',
          'full-time'
        )
        RETURNING *
      `;
      
      // Log technician creation
      if (insertedStaff[0]) {
        logCreate('field_technician', insertedStaff[0].id, {
          employee_id: insertedStaff[0].employee_id,
          name: `${insertedStaff[0].first_name} ${insertedStaff[0].last_name}`,
          email: insertedStaff[0].email,
          department: 'Field Operations'
        });
      }
      
      res.status(201).json({ 
        message: 'Technician added successfully',
        technician: insertedStaff[0]
      });
    } catch (error) {
      log.error('Error adding technician', { error });
      res.status(500).json({ error: 'Failed to add technician' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
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