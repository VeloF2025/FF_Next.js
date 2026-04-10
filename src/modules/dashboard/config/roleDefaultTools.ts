/**
 * Role-based default tools for the dashboard "Tools" section.
 * These are shown when a user doesn't have enough page visit history.
 * Each tool maps to a sidebar module route.
 */

export interface DefaultTool {
  route: string;
  label: string;
  icon: string;       // Lucide icon name
  color: string;      // Tailwind color class
  description: string;
}

export const ROLE_DEFAULT_TOOLS: Record<string, DefaultTool[]> = {
  super_admin: [
    { route: '/field-ops', label: 'Civil QA', icon: 'HardHat', color: 'text-orange-400', description: 'Quality assurance' },
    { route: '/procurement', label: 'Procurement', icon: 'Package', color: 'text-amber-400', description: 'Materials & orders' },
    { route: '/noc', label: 'NOC', icon: 'Wrench', color: 'text-red-400', description: 'Network operations' },
    { route: '/analytics', label: 'Analytics', icon: 'BarChart3', color: 'text-indigo-400', description: 'Performance metrics' },
    { route: '/activate', label: 'Activate', icon: 'Zap', color: 'text-emerald-400', description: 'Activations & QA' },
    { route: '/projects', label: 'Projects', icon: 'FolderOpen', color: 'text-blue-400', description: 'Project management' },
  ],
  admin: [
    { route: '/field-ops', label: 'Civil QA', icon: 'HardHat', color: 'text-orange-400', description: 'Quality assurance' },
    { route: '/procurement', label: 'Procurement', icon: 'Package', color: 'text-amber-400', description: 'Materials & orders' },
    { route: '/noc', label: 'NOC', icon: 'Wrench', color: 'text-red-400', description: 'Network operations' },
    { route: '/staff', label: 'Staff', icon: 'Users', color: 'text-green-400', description: 'Team management' },
    { route: '/projects', label: 'Projects', icon: 'FolderOpen', color: 'text-blue-400', description: 'Project management' },
    { route: '/analytics', label: 'Analytics', icon: 'BarChart3', color: 'text-indigo-400', description: 'Performance metrics' },
  ],
  project_manager: [
    { route: '/projects', label: 'Projects', icon: 'FolderOpen', color: 'text-blue-400', description: 'Project management' },
    { route: '/pole-tracker', label: 'Pole Tracker', icon: 'MapPin', color: 'text-pink-400', description: 'Track installations' },
    { route: '/sow/import', label: 'SOW Import', icon: 'FileText', color: 'text-purple-400', description: 'Import work docs' },
    { route: '/contractors', label: 'Contractors', icon: 'HardHat', color: 'text-orange-400', description: 'Contractor teams' },
    { route: '/procurement', label: 'Procurement', icon: 'Package', color: 'text-amber-400', description: 'Materials & orders' },
    { route: '/activate/reports', label: 'Reports', icon: 'BarChart3', color: 'text-indigo-400', description: 'Activation reports' },
  ],
  site_supervisor: [
    { route: '/field-ops', label: 'Civil QA', icon: 'HardHat', color: 'text-orange-400', description: 'Quality assurance' },
    { route: '/pole-tracker', label: 'Pole Tracker', icon: 'MapPin', color: 'text-pink-400', description: 'Track installations' },
    { route: '/projects', label: 'Projects', icon: 'FolderOpen', color: 'text-blue-400', description: 'View projects' },
    { route: '/activate', label: 'Activate', icon: 'Zap', color: 'text-emerald-400', description: 'Activations & QA' },
    { route: '/noc', label: 'NOC', icon: 'Wrench', color: 'text-red-400', description: 'Report issues' },
    { route: '/reports/progress-today', label: 'Progress', icon: 'Activity', color: 'text-cyan-400', description: 'Today\'s progress' },
  ],
  field_technician: [
    { route: '/field-ops', label: 'Civil QA', icon: 'HardHat', color: 'text-orange-400', description: 'Quality assurance' },
    { route: '/pole-tracker', label: 'Pole Tracker', icon: 'MapPin', color: 'text-pink-400', description: 'Track installations' },
    { route: '/activate', label: 'Activate', icon: 'Zap', color: 'text-emerald-400', description: 'Activations' },
    { route: '/projects', label: 'Projects', icon: 'FolderOpen', color: 'text-blue-400', description: 'View projects' },
    { route: '/fleet', label: 'Fleet', icon: 'Truck', color: 'text-slate-400', description: 'Vehicle check-in' },
    { route: '/reports/progress-today', label: 'Progress', icon: 'Activity', color: 'text-cyan-400', description: 'Today\'s progress' },
  ],
  contractor: [
    { route: '/projects', label: 'Projects', icon: 'FolderOpen', color: 'text-blue-400', description: 'View projects' },
    { route: '/pole-tracker', label: 'Pole Tracker', icon: 'MapPin', color: 'text-pink-400', description: 'Track installations' },
    { route: '/field-ops', label: 'Civil QA', icon: 'HardHat', color: 'text-orange-400', description: 'Quality assurance' },
    { route: '/reports/progress-today', label: 'Progress', icon: 'Activity', color: 'text-cyan-400', description: 'Today\'s progress' },
  ],
  client: [
    { route: '/projects', label: 'Projects', icon: 'FolderOpen', color: 'text-blue-400', description: 'View projects' },
    { route: '/activate/reports', label: 'Reports', icon: 'BarChart3', color: 'text-indigo-400', description: 'Activation reports' },
    { route: '/reports/progress-today', label: 'Progress', icon: 'Activity', color: 'text-cyan-400', description: 'Today\'s progress' },
  ],
  viewer: [
    { route: '/projects', label: 'Projects', icon: 'FolderOpen', color: 'text-blue-400', description: 'View projects' },
    { route: '/analytics', label: 'Analytics', icon: 'BarChart3', color: 'text-indigo-400', description: 'View metrics' },
    { route: '/reports/progress-today', label: 'Progress', icon: 'Activity', color: 'text-cyan-400', description: 'Today\'s progress' },
  ],
};

/**
 * Map a route to its module label (for usage-based tools).
 * Groups sub-routes under their parent module.
 */
export const ROUTE_MODULE_MAP: Record<string, { label: string; icon: string; color: string; description: string }> = {
  '/dashboard': { label: 'Dashboard', icon: 'LayoutDashboard', color: 'text-blue-400', description: 'Overview' },
  '/projects': { label: 'Projects', icon: 'FolderOpen', color: 'text-blue-400', description: 'Project management' },
  '/activate': { label: 'Activate', icon: 'Zap', color: 'text-emerald-400', description: 'Activations & QA' },
  '/noc': { label: 'NOC', icon: 'Wrench', color: 'text-red-400', description: 'Network operations' },
  '/procurement': { label: 'Procurement', icon: 'Package', color: 'text-amber-400', description: 'Materials & orders' },
  '/assets': { label: 'Assets', icon: 'Box', color: 'text-yellow-400', description: 'Equipment management' },
  '/fleet': { label: 'Fleet', icon: 'Truck', color: 'text-slate-400', description: 'Vehicle management' },
  '/staff': { label: 'Staff', icon: 'Users', color: 'text-green-400', description: 'Team management' },
  '/field-ops': { label: 'Civil QA', icon: 'HardHat', color: 'text-orange-400', description: 'Quality assurance' },
  '/conduit': { label: 'Conduit', icon: 'Cable', color: 'text-violet-400', description: 'Financial scoping' },
  '/pole-tracker': { label: 'Pole Tracker', icon: 'MapPin', color: 'text-pink-400', description: 'Track installations' },
  '/analytics': { label: 'Analytics', icon: 'BarChart3', color: 'text-indigo-400', description: 'Performance metrics' },
  '/communications': { label: 'Communications', icon: 'MessageSquare', color: 'text-cyan-400', description: 'Messages & meetings' },
  '/contractors': { label: 'Contractors', icon: 'HardHat', color: 'text-orange-400', description: 'Contractor teams' },
  '/clients': { label: 'Clients', icon: 'Building2', color: 'text-teal-400', description: 'Client management' },
  '/reports': { label: 'Reports', icon: 'FileText', color: 'text-purple-400', description: 'Reports & exports' },
  '/action-items': { label: 'Action Items', icon: 'CheckSquare', color: 'text-orange-400', description: 'Track issues' },
  '/sow': { label: 'SOW', icon: 'FileText', color: 'text-purple-400', description: 'Scope of work' },
  '/settings': { label: 'Settings', icon: 'Settings', color: 'text-gray-400', description: 'System settings' },
};

/**
 * Given a route like '/procurement/sourcing/boq', returns the module key '/procurement'
 */
export function getModuleFromRoute(route: string): string {
  const segments = route.split('/').filter(Boolean);
  return segments.length > 0 ? `/${segments[0]}` : '/dashboard';
}
