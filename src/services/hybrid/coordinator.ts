/**
 * Hybrid Service - Coordinator
 * Coordinates operations between Firebase and Neon services
 */

import { FirebaseProjectService, FirebaseClientService } from './firebase';
import { NeonAnalyticsService } from './neon';
import type { Project } from '@/types/project.types';
import type { Client } from '@/types/client.types';
import { log } from '@/lib/logger';

export class HybridCoordinator {
  private firebaseProjects: FirebaseProjectService;
  private firebaseClients: FirebaseClientService;
  private neonAnalytics: NeonAnalyticsService;

  constructor() {
    this.firebaseProjects = new FirebaseProjectService();
    this.firebaseClients = new FirebaseClientService();
    this.neonAnalytics = new NeonAnalyticsService();
  }

  // ============================================
  // COORDINATED PROJECT OPERATIONS
  // ============================================

  /**
   * Create project with analytics sync
   */
  async createProject(projectData: Omit<Project, 'id'>): Promise<string> {
    // Save to Firebase (real-time operations)
    const projectId = await this.firebaseProjects.createProject(projectData);

    // Trigger analytics sync to Neon (async)
    this.neonAnalytics.syncProjectToAnalytics(projectId, projectData).catch(() => {
      // Silent fail for analytics sync
    });

    return projectId;
  }

  /**
   * Update project with analytics sync
   */
  async updateProject(id: string, updates: Partial<Project>): Promise<void> {
    // Update in Firebase
    await this.firebaseProjects.updateProject(id, updates);

    // Get full project data and sync to analytics
    const updatedProject = await this.firebaseProjects.getProjectById(id);
    if (updatedProject) {
      this.neonAnalytics.syncProjectToAnalytics(id, updatedProject).catch(() => {
        // Silent fail for analytics sync
      });
    }
  }

  /**
   * Delete project (keep analytics for historical data)
   */
  async deleteProject(id: string): Promise<void> {
    // Delete from Firebase
    await this.firebaseProjects.deleteProject(id);
    
    // Note: Keep analytics data for historical reporting
    // Could mark as deleted instead of actual deletion
  }

  /**
   * Get project with analytics
   */
  async getProjectWithAnalytics(id: string) {
    const [project, analytics] = await Promise.all([
      this.firebaseProjects.getProjectById(id),
      this.neonAnalytics.getProjectAnalytics(id)
    ]);

    return { project, analytics };
  }

  // ============================================
  // COORDINATED CLIENT OPERATIONS
  // ============================================

  /**
   * Create client with analytics sync
   */
  async createClient(clientData: Omit<Client, 'id'>): Promise<string> {
    // Save to Firebase
    const clientId = await this.firebaseClients.createClient(clientData);

    // Sync to analytics
    this.neonAnalytics.syncClientToAnalytics(clientId, clientData).catch(() => {
      // Silent fail for analytics sync
    });

    return clientId;
  }

  /**
   * Update client with analytics sync
   */
  async updateClient(id: string, updates: Partial<Client>): Promise<void> {
    // Update in Firebase
    await this.firebaseClients.updateClient(id, updates);

    // Sync updates to analytics
    const updatedClient = await this.firebaseClients.getClientById(id);
    if (updatedClient) {
      this.neonAnalytics.syncClientToAnalytics(id, updatedClient).catch(() => {
        // Silent fail for analytics sync
      });
    }
  }

  /**
   * Get client with analytics
   */
  async getClientWithAnalytics(id: string) {
    const [client, analytics] = await Promise.all([
      this.firebaseClients.getClientById(id),
      this.neonAnalytics.getClientAnalytics(id)
    ]);

    return { client, analytics };
  }

  // ============================================
  // BULK OPERATIONS
  // ============================================

  /**
   * Sync all existing data to analytics
   */
  async syncAllToAnalytics(): Promise<void> {
    try {
      // Get all projects and clients
      const [projects, clients] = await Promise.all([
        this.firebaseProjects.getAllProjects(),
        this.firebaseClients.getAllClients()
      ]);

      // Sync projects
      const projectSyncPromises = projects.map(project => 
        this.neonAnalytics.syncProjectToAnalytics(project.id, project)
      );

      // Sync clients
      const clientSyncPromises = clients.map(client =>
        client.id ? this.neonAnalytics.syncClientToAnalytics(client.id, client) : Promise.resolve()
      );

      // Wait for all syncs to complete (with error tolerance)
      await Promise.allSettled([...projectSyncPromises, ...clientSyncPromises]);

    } catch (error) {
      log.error('Error during bulk sync:', { data: error }, 'coordinator');
      throw new Error('Bulk sync failed');
    }
  }

  /**
   * Get comprehensive dashboard data
   */
  async getDashboardData() {
    try {
      const [
        projects,
        clients,
        projectAnalytics,
        clientAnalytics
      ] = await Promise.all([
        this.firebaseProjects.getAllProjects(),
        this.firebaseClients.getAllClients(),
        this.neonAnalytics.getProjectDashboardData(),
        this.neonAnalytics.getClientDashboardData()
      ]);

      return {
        realTimeData: {
          projects: projects.slice(0, 10), // Recent projects
          clients: clients.slice(0, 10)    // Recent clients
        },
        analytics: {
          projects: projectAnalytics,
          clients: clientAnalytics
        }
      };
    } catch (error) {
      log.error('Error fetching dashboard data:', { data: error }, 'coordinator');
      throw new Error('Failed to fetch dashboard data');
    }
  }

  // ============================================
  // REAL-TIME SUBSCRIPTIONS
  // ============================================

  /**
   * Subscribe to projects with analytics updates
   */
  subscribeToProjectsWithAnalytics(callback: (data: { projects: unknown; analytics: unknown }) => void): () => void {
    return this.firebaseProjects.subscribeToProjects(async (projects) => {
      try {
        const analyticsData = await this.neonAnalytics.getProjectAnalytics();
        callback({ projects, analytics: analyticsData });
      } catch (error) {
        callback({ projects, analytics: null });
      }
    });
  }

  /**
   * Subscribe to clients with analytics updates
   */
  subscribeToClientsWithAnalytics(callback: (data: { clients: unknown; analytics: unknown }) => void): () => void {
    return this.firebaseClients.subscribeToClients(async (clients) => {
      try {
        const analyticsData = await this.neonAnalytics.getClientAnalytics();
        callback({ clients, analytics: analyticsData });
      } catch (error) {
        callback({ clients, analytics: null });
      }
    });
  }
}