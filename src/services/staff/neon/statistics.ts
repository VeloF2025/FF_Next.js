/**
 * Staff Statistics Service
 * Functions for calculating staff statistics and summaries
 */

import { getSql } from '@/lib/neon-sql';
import { StaffSummary } from '@/types/staff.types';
import { hrEmployeePredicate } from '@/lib/staff/hrVisibilityFilters';
import { log } from '@/lib/logger';

/**
 * Get staff summary statistics
 */
export async function getStaffSummary(): Promise<StaffSummary> {
  try {
    // Rule H — exclude self-registered field workers (technician/casual) from
    // every HR statistic. Bare column refs: single-table queries, no alias.
    const sql = getSql();
    const hrOnly = hrEmployeePredicate('');
    const totalResult = await sql`SELECT COUNT(*) as count FROM staff WHERE ${sql.unsafe(hrOnly)}`;
    const activeResult = await sql`SELECT COUNT(*) as count FROM staff WHERE status = 'ACTIVE' ${sql.unsafe('AND ' + hrOnly)}`;
    const inactiveResult = await sql`SELECT COUNT(*) as count FROM staff WHERE status = 'INACTIVE' ${sql.unsafe('AND ' + hrOnly)}`;
    const onLeaveResult = await sql`SELECT COUNT(*) as count FROM staff WHERE status = 'ON_LEAVE' ${sql.unsafe('AND ' + hrOnly)}`;

    // Get department breakdown
    const departmentResult = await sql`
      SELECT department, COUNT(*) as count
      FROM staff
      WHERE ${sql.unsafe(hrOnly)}
      GROUP BY department
    `;
    
    type CountRow = { count: string };
    const totalRows = totalResult as CountRow[];
    const activeRows = activeResult as CountRow[];
    const inactiveRows = inactiveResult as CountRow[];
    const onLeaveRows = onLeaveResult as CountRow[];
    
    const totalStaff = parseInt(totalRows[0]?.count ?? '0');
    const activeStaff = parseInt(activeRows[0]?.count ?? '0');
    const inactiveStaff = parseInt(inactiveRows[0]?.count ?? '0');
    const onLeaveStaff = parseInt(onLeaveRows[0]?.count ?? '0');
    
    // Calculate utilization rate (assuming active staff are utilized)
    const utilizationRate = totalStaff > 0 ? (activeStaff / totalStaff) * 100 : 0;
    
    // Build department breakdown
    const staffByDepartment: { [key: string]: number } = {};
    type DeptRow = { department: string; count: string };
    const deptRows = departmentResult as DeptRow[];
    deptRows.forEach((dept) => {
      staffByDepartment[dept.department] = parseInt(dept.count);
    });
    
    return {
      totalStaff,
      activeStaff,
      inactiveStaff,
      onLeaveStaff,
      availableStaff: activeStaff,
      monthlyGrowth: 0, // TODO: Calculate monthly growth
      averageProjectLoad: 0, // TODO: Calculate average project load
      staffByDepartment,
      staffByLevel: {}, // TODO: Get level breakdown
      staffBySkill: {}, // TODO: Get skill breakdown
      staffByContractType: {}, // TODO: Get contract type breakdown
      averageExperience: 0, // TODO: Calculate average experience
      utilizationRate,
      overallocatedStaff: 0, // TODO: Calculate overallocated staff
      underutilizedStaff: 0, // TODO: Calculate underutilized staff
      topPerformers: [], // TODO: Get top performers
      topSkills: [] // TODO: Get top skills
    };
  } catch (error) {
    log.error('Error fetching staff summary:', { data: error }, 'statistics');
    throw error;
  }
}