import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { log } from '@/lib/logger';
import { 
  StaffMember,
  StaffDropdownOption,
  StaffSummary,
  StaffStatus,
  ProjectAssignment
} from '@/types/staff.types';

/**
 * Type for Firestore document snapshot data
 */
interface FirestoreStaffDoc {
  id: string;
  [key: string]: unknown;
}

/** Firestore QueryDocumentSnapshot shape (firebase types are ts-ignored) */
interface FirestoreDocSnapshot {
  id: string;
  data: () => Record<string, unknown>;
}

/**
 * Converts Firestore document to StaffMember type
 */
function docToStaffMember(doc: FirestoreStaffDoc): StaffMember {
  return {
    ...doc,
    id: doc.id,
  } as StaffMember;
}

/**
 * Specialized query operations for staff
 */
export const staffQueryService = {
  /**
   * Get active staff for dropdown usage
   */
  async getActiveStaff(): Promise<StaffDropdownOption[]> {
    try {
      // Get all staff and filter client-side to avoid index requirement
      const q = query(
        collection(db, 'staff'),
        orderBy('name', 'asc')
      );
      const snapshot = await getDocs(q);
      
      return snapshot.docs
        .map((doc: FirestoreDocSnapshot) => docToStaffMember({ id: doc.id, ...doc.data() }))
        .filter((staff: StaffMember) => staff.status === StaffStatus.ACTIVE)
        .map((staff: StaffMember) => ({
          id: staff.id!,
          name: staff.name,
          email: staff.email,
          position: staff.position,
          department: staff.department,
          level: staff.level,
          status: staff.status,
          currentProjectCount: staff.currentProjectCount || 0,
          maxProjectCount: staff.maxProjectCount || 5,
        } as StaffDropdownOption));
    } catch (error) {
      log.error('Error getting active staff:', { data: error }, 'staffQueryService');
      throw new Error('Failed to fetch active staff');
    }
  },

  /**
   * Get project managers for dropdown usage
   */
  async getProjectManagers(): Promise<StaffDropdownOption[]> {
    try {
      // Get all staff and filter client-side to avoid index requirement
      const q = query(
        collection(db, 'staff'),
        orderBy('name', 'asc')
      );
      const snapshot = await getDocs(q);
      
      // Filter by status and position client-side
      // Look for positions that include "Project Manager" or similar roles
      const managerPositions = [
        'Project Manager',
        'Senior Project Manager', 
        'Operations Manager',
        'Construction Manager',
        'Team Lead'
      ];
      
      return snapshot.docs
        .map((doc: FirestoreDocSnapshot) => docToStaffMember({ id: doc.id, ...doc.data() }))
        .filter((staff: StaffMember) => {
          // Check if active
          if (staff.status !== StaffStatus.ACTIVE) return false;
          
          // Check if position matches any manager position
          const position = staff.position?.toString().toLowerCase() || '';
          return managerPositions.some(mp => 
            position.includes(mp.toLowerCase()) || 
            position.includes('manager') ||
            position.includes('lead') ||
            position.includes('supervisor')
          );
        })
        .map((staff: StaffMember) => ({
          id: staff.id!,
          name: staff.name,
          email: staff.email,
          position: staff.position,
          department: staff.department,
          level: staff.level,
          status: staff.status,
          currentProjectCount: staff.currentProjectCount || 0,
          maxProjectCount: staff.maxProjectCount || 5,
        } as StaffDropdownOption));
    } catch (error) {
      log.error('Error getting project managers:', { data: error }, 'staffQueryService');
      throw new Error('Failed to fetch project managers');
    }
  },

  /**
   * Get staff summary statistics
   */
  async getStaffSummary(): Promise<StaffSummary> {
    try {
      const staff = await staffQueryService.getAllStaff();
      
      const summary: StaffSummary = {
        totalStaff: staff.length,
        activeStaff: staff.filter(s => s.status === StaffStatus.ACTIVE).length,
        onLeaveStaff: staff.filter(s => s.status === StaffStatus.ON_LEAVE).length,
        inactiveStaff: staff.filter(s => s.status === StaffStatus.INACTIVE).length,
        staffByDepartment: {},
        staffByLevel: {},
        staffBySkill: {},
        averageExperience: 0,
        utilizationRate: 0,
        overallocatedStaff: 0,
        underutilizedStaff: 0,
        topPerformers: [],
      };
      
      // Count by department
      staff.forEach(member => {
        summary.staffByDepartment[member.department] = 
          (summary.staffByDepartment[member.department] || 0) + 1;
      });
      
      // Count by level
      staff.forEach(member => {
        if (member.level) {
          summary.staffByLevel[member.level] = 
            (summary.staffByLevel[member.level] || 0) + 1;
        }
      });
      
      // Calculate utilization
      const activeStaff = staff.filter(s => s.status === StaffStatus.ACTIVE);
      if (activeStaff.length > 0) {
        const totalCapacity = activeStaff.reduce((sum, s) => sum + s.maxProjectCount, 0);
        const totalUtilized = activeStaff.reduce((sum, s) => sum + s.currentProjectCount, 0);
        summary.utilizationRate = (totalUtilized / totalCapacity) * 100;
        // Remove averageProjectsPerPerson as it's not in the interface
      }
      
      // Get top performers
      summary.topPerformers = staff
        .filter(s => s.averageProjectRating > 0)
        .sort((a, b) => b.averageProjectRating - a.averageProjectRating)
        .slice(0, 5);
      
      return summary;
    } catch (error) {
      log.error('Error getting staff summary:', { data: error }, 'staffQueryService');
      throw new Error('Failed to fetch staff summary');
    }
  },

  /**
   * Get project assignments for a project
   */
  async getProjectAssignments(projectId: string): Promise<ProjectAssignment[]> {
    try {
      const q = query(
        collection(db, 'projectAssignments'),
        where('projectId', '==', projectId),
        orderBy('assignedDate', 'desc')
      );
      const snapshot = await getDocs(q);
      
      return snapshot.docs.map((doc: FirestoreDocSnapshot) => ({
        id: doc.id,
        ...doc.data()
      } as ProjectAssignment));
    } catch (error) {
      log.error('Error getting project assignments:', { data: error }, 'staffQueryService');
      throw new Error('Failed to fetch project assignments');
    }
  },

  /**
   * Get staff assignments for a staff member
   */
  async getStaffAssignments(staffId: string): Promise<ProjectAssignment[]> {
    try {
      const q = query(
        collection(db, 'projectAssignments'),
        where('staffId', '==', staffId),
        where('status', '==', 'active'),
        orderBy('assignedDate', 'desc')
      );
      const snapshot = await getDocs(q);
      
      return snapshot.docs.map((doc: FirestoreDocSnapshot) => ({
        id: doc.id,
        ...doc.data()
      } as ProjectAssignment));
    } catch (error) {
      log.error('Error getting staff assignments:', { data: error }, 'staffQueryService');
      throw new Error('Failed to fetch staff assignments');
    }
  },

  /**
   * Helper to get all staff (used internally)
   */
  async getAllStaff(): Promise<StaffMember[]> {
    const snapshot = await getDocs(collection(db, 'staff'));
    return snapshot.docs.map((doc: FirestoreDocSnapshot) => docToStaffMember({
      id: doc.id,
      ...doc.data()
    }));
  }
};