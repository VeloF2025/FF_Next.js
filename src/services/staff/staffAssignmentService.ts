import { collection, doc, addDoc, updateDoc, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { ProjectAssignment, StaffMember } from '@/types/staff.types';
import { log } from '@/lib/logger';

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
  ref: unknown;
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
 * Project assignment operations for staff
 */
export const staffAssignmentService = {
  /**
   * Assign staff to project
   */
  async assignToProject(assignment: Omit<ProjectAssignment, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    try {
      const now = Timestamp.now();
      
      const assignmentData = {
        ...assignment,
        createdAt: now,
        updatedAt: now,
      };
      
      const docRef = await addDoc(collection(db, 'projectAssignments'), assignmentData);
      
      // Update staff member's project count
      await this.updateStaffProjectCount(assignment.staffId);
      
      return docRef.id;
    } catch (error) {
      log.error('Error assigning staff to project:', { data: error }, 'staffAssignmentService');
      throw new Error('Failed to assign staff to project');
    }
  },

  /**
   * Update project assignment
   */
  async updateAssignment(id: string, data: Partial<ProjectAssignment>): Promise<void> {
    try {
      const docRef = doc(db, 'projectAssignments', id);
      const updateData = {
        ...data,
        updatedAt: Timestamp.now(),
      };
      
      await updateDoc(docRef, updateData);
      
      // If status changed, update staff project count
      if (data.status) {
        const assignmentDoc = await getDocs(query(
          collection(db, 'projectAssignments'),
          where('id', '==', id)
        ));
        
        const firstDoc = assignmentDoc.docs[0];
        if (!assignmentDoc.empty && firstDoc) {
          const assignment = firstDoc.data() as ProjectAssignment;
          await this.updateStaffProjectCount(assignment.staffId);
        }
      }
    } catch (error) {
      log.error('Error updating assignment:', { data: error }, 'staffAssignmentService');
      throw new Error('Failed to update assignment');
    }
  },

  /**
   * Update staff member's current project count
   */
  async updateStaffProjectCount(staffId: string): Promise<void> {
    try {
      // Get active assignments for this staff member
      const q = query(
        collection(db, 'projectAssignments'),
        where('staffId', '==', staffId),
        where('status', '==', 'active')
      );
      const snapshot = await getDocs(q);
      const activeCount = snapshot.size;
      
      // Update staff member's current project count
      const staffRef = doc(db, 'staff', staffId);
      await updateDoc(staffRef, {
        currentProjectCount: activeCount,
        updatedAt: Timestamp.now(),
      });
    } catch (error) {
      log.error('Error updating staff project count:', { data: error }, 'staffAssignmentService');
      throw new Error('Failed to update staff project count');
    }
  },

  /**
   * Get available staff for a project
   */
  async getAvailableStaff(projectRequirements?: { skills?: string[], department?: string }): Promise<StaffMember[]> {
    try {
      const staffQuery = query(
        collection(db, 'staff'),
        where('status', '==', 'active')
      );
      
      const snapshot = await getDocs(staffQuery);
      let availableStaff: StaffMember[] = snapshot.docs.map((doc: FirestoreDocSnapshot) => docToStaffMember({
        id: doc.id,
        ...doc.data()
      }));
      
      // Filter by availability (not at max capacity)
      availableStaff = availableStaff.filter((staff: StaffMember) =>
        (staff.currentProjectCount || 0) < (staff.maxProjectCount || 5)
      );

      // Filter by requirements if provided
      if (projectRequirements?.skills?.length) {
        availableStaff = availableStaff.filter((staff: StaffMember) =>
          projectRequirements.skills!.some(skill =>
            (staff.skills || []).includes(skill)
          )
        );
      }

      if (projectRequirements?.department) {
        availableStaff = availableStaff.filter((staff: StaffMember) =>
          staff.department === projectRequirements.department
        );
      }
      
      return availableStaff;
    } catch (error) {
      log.error('Error getting available staff:', { data: error }, 'staffAssignmentService');
      throw new Error('Failed to get available staff');
    }
  }
};