import { createContext, useContext, useState, ReactNode } from 'react';

/** Slim project shape stored in React context (display-only fields) */
interface ProjectContextData {
  id: string;
  name: string;
  code: string;
  status: string;
  clientId?: string;
  clientName?: string;
}

interface ProjectContextType {
  currentProject: ProjectContextData | null;
  setCurrentProject: (project: ProjectContextData | null) => void;
  projects: ProjectContextData[];
  setProjects: (projects: ProjectContextData[]) => void;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [currentProject, setCurrentProject] = useState<ProjectContextData | null>(null);
  const [projects, setProjects] = useState<ProjectContextData[]>([]);

  return (
    <ProjectContext.Provider 
      value={{ 
        currentProject, 
        setCurrentProject, 
        projects, 
        setProjects 
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjectContext() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useProjectContext must be used within a ProjectProvider');
  }
  return context;
}