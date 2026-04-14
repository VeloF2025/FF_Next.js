/**
 * Project Access Data Service
 * Handles database queries for project access information
 */

import { db as firestoreDb } from '@/config/firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { UserProjectAccess, ProjectInfo } from './types';
import { ProjectAccessValidator } from './validator';
import type { ServiceResponse } from '@/services/core/BaseService';
import { log } from '@/lib/logger';

/**
 * Project access data operations
 */
export class ProjectAccessDataService {
  /**
   * Fetch user project access from Firestore
   */
  static async fetchUserProjectAccess(userId: string): Promise<ServiceResponse<UserProjectAccess[]>> {
    try {
      // Query Firestore for user's project access
      const userProjectsQuery = query(
        collection(firestoreDb, 'user_project_access'),
        where('userId', '==', userId),
        where('status', '==', 'active')
      );

      const userProjectsSnapshot = await getDocs(userProjectsQuery);
      const projectAccess: UserProjectAccess[] = [];

      for (const docSnap of userProjectsSnapshot.docs) {
        const data = docSnap.data();
        
        // Validate project still exists and user still has access
        const projectDoc = await getDoc(doc(firestoreDb, 'projects', data.projectId));
        if (projectDoc.exists()) {
          const projectData = projectDoc.data();
          
          // Check if user is still a member of the project
          if (projectData.members && projectData.members[userId]) {
            const memberInfo = projectData.members[userId];
            
            projectAccess.push({
              projectId: data.projectId,
              accessLevel: ProjectAccessValidator.mapRoleToAccessLevel(memberInfo.role),
              roles: Array.isArray(memberInfo.roles) ? memberInfo.roles : [memberInfo.role],
              departments: memberInfo.departments || [],
              grantedBy: data.grantedBy || 'system',
              grantedAt: data.grantedAt?.toDate() || new Date(),
              expiresAt: data.expiresAt?.toDate()
            });
          }
        }
      }

      return {
        success: true,
        data: projectAccess
      };
    } catch (error) {
      log.error('[ProjectAccessDataService] fetchUserProjectAccess error:', { data: error }, 'dataService');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch user project access',
        code: 'USER_ACCESS_FETCH_FAILED'
      };
    }
  }

  /**
   * Get project information by ID
   */
  static async getProjectInfo(projectId: string): Promise<ServiceResponse<ProjectInfo>> {
    try {
      const projectDoc = await getDoc(doc(firestoreDb, 'projects', projectId));
      
      if (!projectDoc.exists()) {
        return {
          success: false,
          error: 'Project not found',
          code: 'PROJECT_NOT_FOUND'
        };
      }

      const projectData = projectDoc.data();
      const projectInfo: ProjectInfo = {
        id: projectDoc.id,
        name: projectData.name || 'Unnamed Project',
        status: projectData.status || 'active',
        clientId: projectData.clientId,
        members: projectData.members || {}
      };

      return {
        success: true,
        data: projectInfo
      };
    } catch (error) {
      log.error('[ProjectAccessDataService] getProjectInfo error:', { data: error }, 'dataService');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get project info',
        code: 'PROJECT_FETCH_FAILED'
      };
    }
  }

  /**
   * Check if project exists and is active
   */
  static async isProjectActive(projectId: string): Promise<boolean> {
    try {
      const projectDoc = await getDoc(doc(firestoreDb, 'projects', projectId));
      
      if (!projectDoc.exists()) {
        return false;
      }

      const projectData = projectDoc.data();
      return projectData.status !== 'archived' && projectData.status !== 'deleted';
    } catch (error) {
      log.error('[ProjectAccessDataService] isProjectActive error:', { data: error }, 'dataService');
      return false;
    }
  }

  /**
   * Get user's role in a specific project
   */
  static async getUserProjectRole(userId: string, projectId: string): Promise<string | null> {
    try {
      const projectDoc = await getDoc(doc(firestoreDb, 'projects', projectId));
      
      if (!projectDoc.exists()) {
        return null;
      }

      const projectData = projectDoc.data();
      const memberInfo = projectData.members?.[userId];
      
      return memberInfo?.role || null;
    } catch (error) {
      log.error('[ProjectAccessDataService] getUserProjectRole error:', { data: error }, 'dataService');
      return null;
    }
  }
}