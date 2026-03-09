/**
 * Project API Service
 * Uses API routes instead of direct database access for security
 */

const API_BASE = '/api';

interface DbProject {
  id?: string;
  project_code?: string;
  project_name?: string;
  name?: string; // Database returns 'name' field
  client_id?: string;
  project_type?: string;
  status?: string;
  priority?: string;
  start_date?: string;
  end_date?: string;
  budget?: number;
  description?: string;
  project_manager?: string;
  project_manager_name?: string;
  team_lead?: string;
  location?: string;
  progress_percentage?: number;
  created_at?: string;
  updated_at?: string;
}

interface Project {
  id?: string;
  projectCode?: string;
  projectName: string;
  name?: string; // Alias for projectName for backward compatibility
  clientId?: string;
  projectType?: string;
  status?: string;
  priority?: string;
  startDate?: string;
  endDate?: string;
  budget?: number;
  description?: string;
  projectManager?: string;
  teamLead?: string;
  location?: string;
  progressPercentage?: number;
  created_at?: string;
  updated_at?: string;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  
  const data = await response.json();
  return data.data || data;
}

function transformDbToProject(dbProject: DbProject): Project {
  // Database returns 'name' field, but we support both 'name' and 'project_name'
  const projectName = dbProject.name || dbProject.project_name || '';

  return {
    id: dbProject.id,
    projectCode: dbProject.project_code,
    projectName: projectName,
    name: projectName, // Alias for backward compatibility
    clientId: dbProject.client_id,
    projectType: dbProject.project_type,
    status: dbProject.status,
    priority: dbProject.priority,
    startDate: dbProject.start_date,
    endDate: dbProject.end_date,
    budget: dbProject.budget,
    description: dbProject.description,
    projectManager: dbProject.project_manager_name || dbProject.project_manager,
    teamLead: dbProject.team_lead,
    location: dbProject.location,
    progressPercentage: dbProject.progress_percentage || 0,
    created_at: dbProject.created_at,
    updated_at: dbProject.updated_at
  };
}

function transformProjectToDb(project: Partial<Project>): Partial<DbProject> {
  return {
    id: project.id,
    project_code: project.projectCode,
    project_name: project.projectName || project.name, // Handle both fields
    client_id: project.clientId,
    project_type: project.projectType,
    status: project.status,
    priority: project.priority,
    start_date: project.startDate,
    end_date: project.endDate,
    budget: project.budget,
    description: project.description,
    project_manager: project.projectManager,
    team_lead: project.teamLead,
    location: project.location,
    progress_percentage: project.progressPercentage
  };
}

export const projectApiService = {
  async getAll(): Promise<Project[]> {
    const response = await fetch(`${API_BASE}/projects`);
    const dbProjects = await handleResponse<DbProject[]>(response);
    return dbProjects.map(transformDbToProject);
  },

  async getById(id: string): Promise<Project | null> {
    const response = await fetch(`${API_BASE}/projects?id=${id}`);
    const dbProject = await handleResponse<DbProject | null>(response);
    return dbProject ? transformDbToProject(dbProject) : null;
  },

  async create(projectData: Omit<Project, 'id' | 'created_at' | 'updated_at'>): Promise<Project> {
    const dbData = transformProjectToDb(projectData);
    const response = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dbData)
    });
    const dbProject = await handleResponse<DbProject>(response);
    return transformDbToProject(dbProject);
  },

  async update(id: string, updates: Partial<Project>): Promise<Project> {
    const dbUpdates = transformProjectToDb(updates);
    const response = await fetch(`${API_BASE}/projects?id=${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dbUpdates)
    });
    const dbProject = await handleResponse<DbProject>(response);
    return transformDbToProject(dbProject);
  },

  async delete(id: string): Promise<{ success: boolean; message: string }> {
    const response = await fetch(`${API_BASE}/projects?id=${id}`, {
      method: 'DELETE'
    });
    return handleResponse<{ success: boolean; message: string }>(response);
  },

  // Compatibility methods to match existing service interface
  async getActiveProjects(): Promise<Project[]> {
    const projects = await this.getAll();
    return projects.filter(p => p.status === 'active' || p.status === 'in_progress');
  },

  async getProjectsByClient(clientId: string): Promise<Project[]> {
    const projects = await this.getAll();
    return projects.filter(p => p.clientId === clientId);
  },

  async getProjectSummary(): Promise<{
    totalProjects: number;
    activeProjects: number;
    completedProjects: number;
    totalBudget: number;
  }> {
    const projects = await this.getAll();
    
    return {
      totalProjects: projects.length,
      activeProjects: projects.filter(p => p.status === 'active' || p.status === 'in_progress').length,
      completedProjects: projects.filter(p => p.status === 'completed').length,
      totalBudget: projects.reduce((sum, p) => sum + (p.budget || 0), 0)
    };
  }
};