export interface MCAgent {
  agent: string;
  status: 'online' | 'offline' | 'busy';
  current_task: string | null;
  last_active: string;
  last_heartbeat: string;
  type: string;
  role: string;
  capabilities: string;
}

export interface MCMessage {
  id: number;
  ts: string;
  from_agent: string;
  to_agent: string | null;
  message: string;
  type: string;
  metadata: string | null;
}

export interface MCTask {
  id: number;
  title: string;
  description: string | null;
  status: 'pending' | 'in-progress' | 'completed';
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  tags: string | null;
}

export interface MCService {
  name: string;
  label: string;
  status: string;
  port: number | null;
  portOpen: boolean | null;
  upSince: string | null;
}

export interface MCSystemHealth {
  uptimeSeconds: number;
  memory: { total: number; available: number; used: number; percent: number };
  disk: { total: number; used: number; available: number; percent: number };
  loadAvg: number[];
}

export interface MCStats {
  totalMessages: number;
  todayMessages: number;
  onlineAgents: number;
  totalAgents: number;
  pendingTasks: number;
  inProgressTasks: number;
}

export interface MCDashboard {
  agents: MCAgent[];
  recentMessages: MCMessage[];
  tasks: MCTask[];
  recentEvents: any[];
  system: MCSystemHealth;
  services: MCService[];
  stats: MCStats;
  timestamp: string;
}
