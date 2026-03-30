/**
 * Staff Statistics Service
 * Functions for calculating staff statistics and summaries
 */

import { getSql } from '@/lib/neon-sql';
import { StaffSummary } from '@/types/staff.types';
import { log } from '@/lib/logger';

/**
 * Get staff summary statistics
 */
export async function getStaffSummary(): Promise<StaffSummary> {
  try {
    const totalResult = await getSql()`SELECT COUNT(*) as count FROM staff`;
    const activeResult = await getSql()`SELECT COUNT(*) as count FROM staff WHERE status = 'ACTIVE'`;
    const inactiveResult = await getSql()`SELECT COUNT(*) as count FROM staff WHERE status = 'INACTIVE'`;
    const onLeaveResult = await getSql()`SELECT COUNT(*) as count FROM staff WHERE status = 'ON_LEAVE'`;
    
    // Get department breakdown
    const departmentResult = await getSql()`
      SELECT department, COUNT(*) as count 
      FROM staff 
      GROUP BY department
    `;
    
    const totalRows = totalResult as any[];
    const activeRows = activeResult as any[];
    const inactiveRows = inactiveResult as any[];
    const onLeaveRows = onLeaveResult as any[];
    
    const totalStaff = parseInt(totalRows[0].count);
    const activeStaff = parseInt(activeRows[0].count);
    const inactiveStaff = parseInt(inactiveRows[0].count);
    const onLeaveStaff = parseInt(onLeaveRows[0].count);
    
    // Calculate utilization rate (assuming active staff are utilized)
    const utilizationRate = totalStaff > 0 ? (activeStaff / totalStaff) * 100 : 0;
    
    // Build department breakdown
    const staffByDepartment: { [key: string]: number } = {};
    const deptRows = departmentResult as any[];
    deptRows.forEach((dept: any) => {
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