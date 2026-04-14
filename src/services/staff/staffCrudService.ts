import { collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc, query, where, orderBy, onSnapshot, Timestamp, Unsubscribe } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { log } from '@/lib/logger';
import { 
  StaffMember, 
  StaffFormData,
  StaffFilter
} from '@/types/staff.types';

/**
 * Type for Firestore document snapshot data
 * Represents the raw data structure returned from Firestore
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
  exists: () => boolean;
}

/** Firestore QuerySnapshot shape (firebase types are ts-ignored) */
interface FirestoreQuerySnapshot {
  docs: FirestoreDocSnapshot[];
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
 * Core CRUD operations for staff management
 */
export const staffCrudService = {
  /**
   * Get all staff with optional filtering
   */
  async getAll(filter?: StaffFilter): Promise<StaffMember[]> {
    try {
      // Get all staff without filtering to avoid index requirements
      const q = query(collection(db, 'staff'), orderBy('name', 'asc'));
      const snapshot = await getDocs(q);
      
      let staffMembers: StaffMember[] = snapshot.docs.map((doc: FirestoreDocSnapshot) => docToStaffMember({
        id: doc.id,
        ...doc.data(),
      }));

      // Apply all filters client-side
      if (filter?.status?.length) {
        staffMembers = staffMembers.filter((staff: StaffMember) =>
          filter.status!.includes(staff.status)
        );
      }
      
      if (filter?.department?.length) {
        staffMembers = staffMembers.filter((staff: StaffMember) =>
          filter.department!.includes(staff.department)
        );
      }
      
      if (filter?.level?.length) {
        staffMembers = staffMembers.filter((staff: StaffMember) =>
          staff.level && filter.level!.includes(staff.level)
        );
      }
      
      if (filter?.managerId) {
        staffMembers = staffMembers.filter((staff: StaffMember) =>
          staff.managerId === filter.managerId
        );
      }
      
      // Apply search term filter
      if (filter?.searchTerm) {
        const searchTerm = filter.searchTerm.toLowerCase();
        staffMembers = staffMembers.filter((staff: StaffMember) =>
          staff.name.toLowerCase().includes(searchTerm) ||
          staff.email.toLowerCase().includes(searchTerm) ||
          staff.phone.includes(searchTerm) ||
          staff.employeeId.toLowerCase().includes(searchTerm) ||
          staff.position.toString().toLowerCase().includes(searchTerm)
        );
      }
      
      return staffMembers;
    } catch (error) {
      log.error('Error getting staff:', { data: error }, 'staffCrudService');
      throw new Error('Failed to fetch staff');
    }
  },

  /**
   * Get staff member by ID
   */
  async getById(id: string): Promise<StaffMember | null> {
    try {
      const docRef = doc(db, 'staff', id);
      const snapshot = await getDoc(docRef);
      
      if (!snapshot.exists()) {
        return null;
      }
      
      return { 
        id: snapshot.id, 
        ...snapshot.data() 
      } as StaffMember;
    } catch (error) {
      log.error('Error getting staff member:', { data: error }, 'staffCrudService');
      throw new Error('Failed to fetch staff member');
    }
  },

  /**
   * Create new staff member
   */
  async create(data: StaffFormData): Promise<string> {
    try {
      const now = Timestamp.now();
      
      // Build staff data without undefined values
      const staffData: Record<string, unknown> = {
        ...data,
        
        // Convert dates
        startDate: Timestamp.fromDate(data.startDate),
        
        // Set default values
        alternativePhone: data.alternativePhone || '',
        managerName: '',
        reportsTo: data.managerId || '',
        specializations: [],
        emergencyContactName: data.emergencyContactName || '',
        emergencyContactPhone: data.emergencyContactPhone || '',
        salaryGrade: data.salaryGrade || '',
        hourlyRate: data.hourlyRate || 0,
        
        // Initialize arrays and metrics
        certifications: [],
        activeProjectIds: [],
        currentProjectCount: 0,
        totalProjectsCompleted: 0,
        averageProjectRating: 0,
        onTimeCompletionRate: 0,
        assignedEquipment: [],
        vehicleAssigned: '',
        toolsAssigned: [],
        trainingRecords: [],
        performanceNotes: '',
        profilePhotoUrl: '',
        bio: '',
        
        // Set audit fields
        createdAt: now,
        updatedAt: now,
        createdBy: 'current-user', // TODO: Get from auth context
        lastModifiedBy: 'current-user',
      };
      
      // Only add endDate if it exists
      if (data.endDate) {
        staffData.endDate = Timestamp.fromDate(data.endDate);
      }
      
      // Remove any undefined values that Firebase doesn't accept
      Object.keys(staffData).forEach(key => {
        if (staffData[key] === undefined) {
          delete staffData[key];
        }
      });
      
      const docRef = await addDoc(collection(db, 'staff'), staffData);
      return docRef.id;
    } catch (error) {
      log.error('Error creating staff member:', { data: error }, 'staffCrudService');
      throw new Error('Failed to create staff member');
    }
  },

  /**
   * Update staff member
   */
  async update(id: string, data: Partial<StaffFormData>): Promise<void> {
    try {
      const docRef = doc(db, 'staff', id);
      const updateData: Record<string, unknown> = {
        ...data,
        updatedAt: Timestamp.now(),
        lastModifiedBy: 'current-user', // TODO: Get from auth context
      };
      
      // Convert dates if provided
      if (data.startDate) {
        updateData.startDate = Timestamp.fromDate(data.startDate);
      }
      if (data.endDate) {
        updateData.endDate = Timestamp.fromDate(data.endDate);
      }
      
      await updateDoc(docRef, updateData);
    } catch (error) {
      log.error('Error updating staff member:', { data: error }, 'staffCrudService');
      throw new Error('Failed to update staff member');
    }
  },

  /**
   * Delete staff member
   */
  async delete(id: string): Promise<void> {
    try {
      // Check if staff member has active projects
      const projectsQuery = query(
        collection(db, 'projectAssignments'),
        where('staffId', '==', id),
        where('status', '==', 'active')
      );
      const projectsSnapshot = await getDocs(projectsQuery);
      
      if (!projectsSnapshot.empty) {
        throw new Error('Cannot delete staff member with active project assignments');
      }
      
      await deleteDoc(doc(db, 'staff', id));
    } catch (error) {
      log.error('Error deleting staff member:', { data: error }, 'staffCrudService');
      throw new Error('Failed to delete staff member');
    }
  },

  /**
   * Subscribe to staff changes
   */
  subscribeToStaff(
    callback: (staff: StaffMember[]) => void,
    filter?: StaffFilter
  ): Unsubscribe {
    // Get all staff to avoid index requirements
    const q = query(collection(db, 'staff'), orderBy('name', 'asc'));
    
    return onSnapshot(q, (snapshot: FirestoreQuerySnapshot) => {
      let staffMembers: StaffMember[] = snapshot.docs.map((doc: FirestoreDocSnapshot) => docToStaffMember({
        id: doc.id,
        ...doc.data(),
      }));
      
      // Apply filters client-side
      if (filter?.status?.length) {
        staffMembers = staffMembers.filter((staff: StaffMember) =>
          filter.status!.includes(staff.status)
        );
      }
      
      if (filter?.department?.length) {
        staffMembers = staffMembers.filter((staff: StaffMember) =>
          filter.department!.includes(staff.department)
        );
      }
      
      if (filter?.level?.length) {
        staffMembers = staffMembers.filter((staff: StaffMember) =>
          staff.level && filter.level!.includes(staff.level)
        );
      }
      
      if (filter?.searchTerm) {
        const searchTerm = filter.searchTerm.toLowerCase();
        staffMembers = staffMembers.filter((staff: StaffMember) =>
          staff.name.toLowerCase().includes(searchTerm) ||
          staff.email.toLowerCase().includes(searchTerm) ||
          staff.phone.includes(searchTerm) ||
          staff.employeeId.toLowerCase().includes(searchTerm) ||
          staff.position.toString().toLowerCase().includes(searchTerm)
        );
      }
      
      callback(staffMembers);
    });
  },

  /**
   * Subscribe to single staff member changes
   */
  subscribeToStaffMember(
    staffId: string,
    callback: (staff: StaffMember | null) => void
  ): Unsubscribe {
    const docRef = doc(db, 'staff', staffId);
    
    return onSnapshot(docRef, (snapshot: FirestoreDocSnapshot) => {
      if (snapshot.exists()) {
        const staff = docToStaffMember({
          id: snapshot.id,
          ...snapshot.data(),
        });
        callback(staff);
      } else {
        callback(null);
      }
    });
  }
};