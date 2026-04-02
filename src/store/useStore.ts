import { create } from 'zustand';
import { subscribeWithSelector, persist } from 'zustand/middleware';

/** Slim project shape stored in global app state (selected project context) */
interface SelectedProjectState {
  id: string;
  name: string;
  description?: string;
  status?: string;
  clientId?: string;
  projectType?: string;
  priority?: string;
  startDate?: string;
  endDate?: string;
  budget?: number;
  createdAt?: string;
  updatedAt?: string;
}

interface Notification {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
  timestamp: Date;
  read?: boolean;
}

interface ProjectFilters {
  status?: string;
  search?: string;
  clientId?: string;
  priority?: string;
  projectType?: string;
}

interface AppState {
  // Projects
  selectedProject: SelectedProjectState | null;
  projectFilters: ProjectFilters;
  
  // UI State
  sidebarOpen: boolean;
  notifications: Notification[];
  
  // Theme
  theme: 'light' | 'dark' | 'system';
  
  // Loading states
  isLoading: Record<string, boolean>;
  
  // Actions
  setSelectedProject: (project: SelectedProjectState | null) => void;
  setProjectFilters: (filters: Partial<ProjectFilters>) => void;
  clearProjectFilters: () => void;
  
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;
  markNotificationRead: (id: string) => void;
  clearNotifications: () => void;
  
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  
  setLoading: (key: string, loading: boolean) => void;
  clearLoading: (key: string) => void;
}

// Helper function to generate unique IDs
const generateId = () => Math.random().toString(36).substr(2, 9);

// Create the store with middleware
export const useStore = create<AppState>()(
  persist(
    subscribeWithSelector((set, get) => ({
      // Initial state
      selectedProject: null,
      projectFilters: {},
      sidebarOpen: true,
      notifications: [],
      theme: 'system',
      isLoading: {},
      
      // Project actions
      setSelectedProject: (project) => set({ selectedProject: project }),
      
      setProjectFilters: (filters) => 
        set((state) => ({ 
          projectFilters: { ...state.projectFilters, ...filters } 
        })),
      
      clearProjectFilters: () => set({ projectFilters: {} }),
      
      // Sidebar actions
      toggleSidebar: () => 
        set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      
      // Notification actions
      addNotification: (notification) =>
        set((state) => ({
          notifications: [
            ...state.notifications,
            {
              ...notification,
              id: generateId(),
              timestamp: new Date(),
            },
          ],
        })),
      
      removeNotification: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        })),
      
      markNotificationRead: (id) =>
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n
          ),
        })),
      
      clearNotifications: () => set({ notifications: [] }),
      
      // Theme actions
      setTheme: (theme) => set({ theme }),
      
      // Loading actions
      setLoading: (key, loading) =>
        set((state) => ({
          isLoading: { ...state.isLoading, [key]: loading },
        })),
      
      clearLoading: (key) =>
        set((state) => {
          const { [key]: _, ...rest } = state.isLoading;
          return { isLoading: rest };
        }),
    })),
    {
      name: 'fibreflow-app-state',
      // Only persist certain state slices
      partialize: (state) => ({
        theme: state.theme,
        sidebarOpen: state.sidebarOpen,
        projectFilters: state.projectFilters,
      }),
    }
  )
);

// Selector hooks for performance optimization
export const useSelectedProject = () => useStore((state) => state.selectedProject);
// Re-export type for consumers that need to type-check the selected project state
export type { SelectedProjectState };
export const useProjectFilters = () => useStore((state) => state.projectFilters);
export const useSidebarOpen = () => useStore((state) => state.sidebarOpen);
export const useNotifications = () => useStore((state) => state.notifications);
export const useTheme = () => useStore((state) => state.theme);
export const useIsLoading = (key: string) => useStore((state) => state.isLoading[key] || false);

// Action hooks for better organization
export const useStoreActions = () => useStore((state) => ({
  setSelectedProject: state.setSelectedProject,
  setProjectFilters: state.setProjectFilters,
  clearProjectFilters: state.clearProjectFilters,
  toggleSidebar: state.toggleSidebar,
  setSidebarOpen: state.setSidebarOpen,
  addNotification: state.addNotification,
  removeNotification: state.removeNotification,
  markNotificationRead: state.markNotificationRead,
  clearNotifications: state.clearNotifications,
  setTheme: state.setTheme,
  setLoading: state.setLoading,
  clearLoading: state.clearLoading,
}));

export default useStore;