/**
 * Project Query Service
 * Complex querying, filtering, and search operations
 */

import { 
  collection, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  limit, 
  DocumentSnapshot
} from 'firebase/firestore';
import { db } from '../../../../../config/firebase';
import { Project, ProjectListQuery } from '../../../types/project.types';
import { ProjectQueryResult } from '../types/service.types';
import { log } from '@/lib/logger';

/** Firestore QueryDocumentSnapshot shape (firebase types are ts-ignored) */
interface FirestoreDocSnapshot {
  id: string;
  ref: unknown;
  exists: () => boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: () => Record<string, any>;
}

const COLLECTION_NAME = 'projects';

export class ProjectQueryService {
  static async getProjects(queryOptions?: ProjectListQuery): Promise<ProjectQueryResult> {
    try {
      const q = collection(db, COLLECTION_NAME);
      const constraints: ReturnType<typeof where>[] = [];

      // Apply filters
      if (queryOptions?.filters) {
        const filters = queryOptions.filters;
        
        if (filters.status && filters.status.length > 0) {
          constraints.push(where('status', 'in', filters.status));
        }
        
        if (filters.priority && filters.priority.length > 0) {
          constraints.push(where('priority', 'in', filters.priority));
        }
        
        if (filters.clientId) {
          constraints.push(where('clientId', '==', filters.clientId));
        }
        
        if (filters.projectManagerId) {
          constraints.push(where('projectManagerId', '==', filters.projectManagerId));
        }
      }

      // Apply sorting
      if (queryOptions?.sort) {
        const { field, direction } = queryOptions.sort;
        constraints.push(orderBy(field, direction));
      } else {
        constraints.push(orderBy('createdAt', 'desc'));
      }

      // Apply pagination
      const pageLimit = queryOptions?.limit || 20;
      constraints.push(limit(pageLimit + 1));

      const queryRef = query(q, ...constraints);
      const snapshot = await getDocs(queryRef);
      
      const projects: Project[] = [];
      let lastVisible: DocumentSnapshot | undefined;
      
      snapshot.docs.slice(0, pageLimit).forEach((doc: FirestoreDocSnapshot, index: number) => {
        if (index === pageLimit - 1) {
          lastVisible = doc as unknown as DocumentSnapshot;
        }
        projects.push({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || doc.data().createdAt,
          updatedAt: doc.data().updatedAt?.toDate?.()?.toISOString() || doc.data().updatedAt,
        } as Project);
      });

      const result: ProjectQueryResult = {
        projects,
        total: projects.length,
        hasMore: snapshot.docs.length > pageLimit,
      };
      
      if (lastVisible) {
        result.lastDoc = lastVisible;
      }
      
      return result;
    } catch (error) {
      log.error('Error fetching projects:', { data: error }, 'ProjectQueryService');
      throw new Error('Failed to fetch projects');
    }
  }

  static async getProjectsByClient(clientId: string): Promise<Project[]> {
    try {
      const q = query(
        collection(db, COLLECTION_NAME),
        where('clientId', '==', clientId),
        orderBy('createdAt', 'desc')
      );
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map((doc: FirestoreDocSnapshot) => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || doc.data().createdAt,
        updatedAt: doc.data().updatedAt?.toDate?.()?.toISOString() || doc.data().updatedAt,
      } as Project));
    } catch (error) {
      log.error('Error fetching projects by client:', { data: error }, 'ProjectQueryService');
      throw new Error('Failed to fetch projects by client');
    }
  }

  static async getProjectsByManager(managerId: string): Promise<Project[]> {
    try {
      const q = query(
        collection(db, COLLECTION_NAME),
        where('projectManagerId', '==', managerId),
        orderBy('createdAt', 'desc')
      );
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map((doc: FirestoreDocSnapshot) => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || doc.data().createdAt,
        updatedAt: doc.data().updatedAt?.toDate?.()?.toISOString() || doc.data().updatedAt,
      } as Project));
    } catch (error) {
      log.error('Error fetching projects by manager:', { data: error }, 'ProjectQueryService');
      throw new Error('Failed to fetch projects by manager');
    }
  }
}