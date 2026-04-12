/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore — firebase not in project dependencies
import { collection, query, where, orderBy, getDocs, doc, addDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { log } from '@/lib/logger';
// @ts-ignore — firebase config not available
import { db } from '@/config/firebase';
import {
  Client,
  ClientDropdownOption,
  ClientSummary,
  ClientStatus,
  ContactHistory
} from '@/types/client.types';

/** Minimal shape of a Firestore QueryDocumentSnapshot (firebase not in deps) */
interface FirestoreDoc {
  id: string;
  data(): Record<string, unknown>;
}

/** Minimal project data shape used for client metric calculations */
interface ProjectData {
  status?: string;
  budget?: number;
}

/**
 * Specialized query operations for clients
 */
export const clientQueryService = {
  /**
   * Get active clients for dropdown usage
   */
  async getActiveClients(): Promise<ClientDropdownOption[]> {
    try {
      // Use simple query and filter client-side to avoid index requirement
      const q = query(
        collection(db, 'clients'),
        orderBy('name', 'asc')
      );
      const snapshot = await getDocs(q);

      // Filter for active/prospect clients client-side
      const activeStatuses = [ClientStatus.ACTIVE, ClientStatus.PROSPECT];

      return (snapshot.docs as FirestoreDoc[])
        .map((d) => ({ id: d.id, ...d.data() } as Client))
        .filter((client) => activeStatuses.includes(client.status))
        .map((client) => ({
          id: client.id!,
          name: client.name,
          contactPerson: client.contactPerson,
          email: client.email,
          phone: client.phone,
          status: client.status,
          category: client.category,
        }));
    } catch (error) {
      log.error('clientQueryService', { action: 'getActiveClientsFailed', error });
      throw new Error('Failed to fetch active clients');
    }
  },

  /**
   * Get client summary statistics
   */
  async getClientSummary(): Promise<ClientSummary> {
    try {
      const clients = await clientQueryService.getAllClients();

      const summary: ClientSummary = {
        totalClients: clients.length,
        activeClients: clients.filter(c => c.status === ClientStatus.ACTIVE).length,
        prospectClients: clients.filter(c => c.status === ClientStatus.PROSPECT).length,
        inactiveClients: clients.filter(c => c.status === ClientStatus.INACTIVE).length,
        totalProjectValue: clients.reduce((sum, c) => sum + c.totalProjectValue, 0),
        averageProjectValue: 0,
        topClientsByValue: [],
        clientsByCategory: {},
        clientsByStatus: {},
        clientsByPriority: {},
        monthlyGrowth: 0, // TODO: Calculate based on created dates
        conversionRate: 0, // TODO: Calculate prospects to active ratio
      };

      // Calculate average project value
      if (clients.length > 0) {
        summary.averageProjectValue = summary.totalProjectValue / clients.length;
      }

      // Get top clients by value
      summary.topClientsByValue = clients
        .sort((a, b) => b.totalProjectValue - a.totalProjectValue)
        .slice(0, 5);

      // Count by category
      clients.forEach(client => {
        summary.clientsByCategory[client.category] =
          (summary.clientsByCategory[client.category] || 0) + 1;
      });

      // Count by status
      clients.forEach(client => {
        summary.clientsByStatus[client.status] =
          (summary.clientsByStatus[client.status] || 0) + 1;
      });

      // Count by priority
      clients.forEach(client => {
        summary.clientsByPriority[client.priority] =
          (summary.clientsByPriority[client.priority] || 0) + 1;
      });

      return summary;
    } catch (error) {
      log.error('clientQueryService', { action: 'getClientSummaryFailed', error });
      throw new Error('Failed to fetch client summary');
    }
  },

  /**
   * Update client project metrics
   */
  async updateClientMetrics(clientId: string): Promise<void> {
    try {
      // Get all projects for this client
      const projectsQuery = query(
        collection(db, 'projects'),
        where('clientId', '==', clientId)
      );
      const projectsSnapshot = await getDocs(projectsQuery);
      const projects = (projectsSnapshot.docs as FirestoreDoc[]).map((d) => d.data() as ProjectData);

      // Calculate metrics
      const totalProjects = projects.length;
      const activeProjects = projects.filter((p) => p.status === 'active').length;
      const completedProjects = projects.filter((p) => p.status === 'completed').length;
      const totalProjectValue = projects.reduce((sum: number, p: ProjectData) => sum + (p.budget || 0), 0);
      const averageProjectValue = totalProjects > 0 ? totalProjectValue / totalProjects : 0;

      // Update client metrics
      const clientRef = doc(db, 'clients', clientId);
      await updateDoc(clientRef, {
        totalProjects,
        activeProjects,
        completedProjects,
        totalProjectValue,
        averageProjectValue,
        updatedAt: Timestamp.now(),
      });
    } catch (error) {
      log.error('clientQueryService', { action: 'updateClientMetricsFailed', error });
      throw new Error('Failed to update client metrics');
    }
  },

  /**
   * Add contact history entry
   */
  async addContactHistory(contactHistory: Omit<ContactHistory, 'id' | 'createdAt'>): Promise<string> {
    try {
      const historyData = {
        ...contactHistory,
        createdAt: Timestamp.now(),
      };

      const docRef = await addDoc(collection(db, 'contactHistory'), historyData);

      // Update client's last contact date
      const clientRef = doc(db, 'clients', contactHistory.clientId);
      await updateDoc(clientRef, {
        lastContactDate: contactHistory.contactDate,
        updatedAt: Timestamp.now(),
      });

      return docRef.id;
    } catch (error) {
      log.error('clientQueryService', { action: 'addContactHistoryFailed', error });
      throw new Error('Failed to add contact history');
    }
  },

  /**
   * Get contact history for a client
   */
  async getContactHistory(clientId: string): Promise<ContactHistory[]> {
    try {
      const q = query(
        collection(db, 'contactHistory'),
        where('clientId', '==', clientId),
        orderBy('contactDate', 'desc')
      );
      const snapshot = await getDocs(q);

      return (snapshot.docs as FirestoreDoc[]).map((d) => ({
        id: d.id,
        ...d.data()
      } as ContactHistory));
    } catch (error) {
      log.error('clientQueryService', { action: 'getContactHistoryFailed', error });
      throw new Error('Failed to fetch contact history');
    }
  },

  /**
   * Helper to get all clients (used internally)
   */
  async getAllClients(): Promise<Client[]> {
    const snapshot = await getDocs(collection(db, 'clients'));
    return (snapshot.docs as FirestoreDoc[]).map((d) => ({
      id: d.id,
      ...d.data()
    } as Client));
  }
};
