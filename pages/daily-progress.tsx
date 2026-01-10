import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { Badge } from '@/shared/components/ui/Badge';
import { Progress } from '@/shared/components/ui/Progress';
import { 
  TrendingUp, 
  Users, 
  CheckCircle, 
  Clock, 
  AlertCircle,
  Calendar,
  Activity,
  Target,
  BarChart3
} from 'lucide-react';

interface DailyStats {
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  pendingTasks: number;
  completionRate: number;
  activeTeams: number;
  activeProjects: number;
  hoursWorked: number;
}

interface TaskProgress {
  id: string;
  title: string;
  project: string;
  assignee: string;
  status: 'completed' | 'in_progress' | 'pending';
  progress: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  completedAt?: string;
  startedAt?: string;
}

export default function DailyProgressPage() {
  const [stats, setStats] = useState<DailyStats>({
    totalTasks: 48,
    completedTasks: 32,
    inProgressTasks: 12,
    pendingTasks: 4,
    completionRate: 67,
    activeTeams: 6,
    activeProjects: 3,
    hoursWorked: 186
  });

  const [todaysTasks, setTodaysTasks] = useState<TaskProgress[]>([
    {
      id: '1',
      title: 'Install fiber cable - Section A',
      project: 'Sandton Network Upgrade',
      assignee: 'John Smith',
      status: 'completed',
      progress: 100,
      priority: 'high',
      completedAt: '09:30 AM'
    },
    {
      id: '2',
      title: 'Pole inspection - Zone 3',
      project: 'Midrand Infrastructure',
      assignee: 'Sarah Johnson',
      status: 'completed',
      progress: 100,
      priority: 'medium',
      completedAt: '11:15 AM'
    },
    {
      id: '3',
      title: 'Drop cable installation - Unit 45-52',
      project: 'Rosebank Residential',
      assignee: 'Mike Williams',
      status: 'in_progress',
      progress: 75,
      priority: 'high',
      startedAt: '08:00 AM'
    },
    {
      id: '4',
      title: 'Quality check - Node B12',
      project: 'Sandton Network Upgrade',
      assignee: 'Emma Davis',
      status: 'in_progress',
      progress: 60,
      priority: 'medium',
      startedAt: '10:00 AM'
    },
    {
      id: '5',
      title: 'Equipment setup - Site C',
      project: 'Midrand Infrastructure',
      assignee: 'Tom Brown',
      status: 'pending',
      progress: 0,
      priority: 'low'
    }
  ]);

  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-500/20 text-green-400';
      case 'in_progress': return 'bg-blue-500/20 text-blue-400';
      case 'pending': return 'bg-yellow-500/20 text-yellow-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const refreshData = async () => {
    setLoading(true);
    // Simulate API call
    setTimeout(() => {
      setLoading(false);
    }, 1000);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Daily Progress</h1>
            <p className="text-[var(--ff-text-secondary)]">Track today's field operations and team performance</p>
          </div>
          <div className="flex gap-3">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]"
            />
            <Button onClick={refreshData} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Completion Rate</p>
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.completionRate}%</p>
                  <p className="text-xs text-green-400 mt-1">
                    +5% from yesterday
                  </p>
                </div>
                <div className="bg-green-500/20 p-3 rounded-full">
                  <TrendingUp className="h-6 w-6 text-green-400" />
                </div>
              </div>
              <Progress value={stats.completionRate} className="mt-3" />
            </CardContent>
          </Card>

          <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Tasks Today</p>
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.totalTasks}</p>
                  <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                    {stats.completedTasks} completed
                  </p>
                </div>
                <div className="bg-blue-500/20 p-3 rounded-full">
                  <CheckCircle className="h-6 w-6 text-blue-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Active Teams</p>
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.activeTeams}</p>
                  <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                    Across {stats.activeProjects} projects
                  </p>
                </div>
                <div className="bg-purple-500/20 p-3 rounded-full">
                  <Users className="h-6 w-6 text-purple-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Hours Worked</p>
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.hoursWorked}</p>
                  <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                    Combined team hours
                  </p>
                </div>
                <div className="bg-orange-500/20 p-3 rounded-full">
                  <Clock className="h-6 w-6 text-orange-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Progress Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Task Status Distribution */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Task Distribution
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-[var(--ff-text-secondary)]">Completed</span>
                  <span className="text-sm font-medium text-[var(--ff-text-primary)]">{stats.completedTasks}</span>
                </div>
                <Progress value={(stats.completedTasks / stats.totalTasks) * 100} className="h-2 bg-green-500/20" />
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-[var(--ff-text-secondary)]">In Progress</span>
                  <span className="text-sm font-medium text-[var(--ff-text-primary)]">{stats.inProgressTasks}</span>
                </div>
                <Progress value={(stats.inProgressTasks / stats.totalTasks) * 100} className="h-2 bg-blue-500/20" />
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-[var(--ff-text-secondary)]">Pending</span>
                  <span className="text-sm font-medium text-[var(--ff-text-primary)]">{stats.pendingTasks}</span>
                </div>
                <Progress value={(stats.pendingTasks / stats.totalTasks) * 100} className="h-2 bg-yellow-500/20" />
              </div>
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Today's Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {todaysTasks.map((task) => (
                  <div key={task.id} className="flex items-center justify-between p-3 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)]">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <Badge className={getPriorityColor(task.priority)} variant="default">
                          {task.priority}
                        </Badge>
                        <h4 className="font-medium text-[var(--ff-text-primary)]">{task.title}</h4>
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-sm text-[var(--ff-text-secondary)]">
                        <span>{task.project}</span>
                        <span>•</span>
                        <span>{task.assignee}</span>
                        {task.completedAt && (
                          <>
                            <span>•</span>
                            <span>Completed at {task.completedAt}</span>
                          </>
                        )}
                        {task.startedAt && task.status === 'in_progress' && (
                          <>
                            <span>•</span>
                            <span>Started at {task.startedAt}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {task.status === 'in_progress' && (
                        <div className="w-24">
                          <Progress value={task.progress} className="h-2" />
                          <span className="text-xs text-[var(--ff-text-tertiary)]">{task.progress}%</span>
                        </div>
                      )}
                      <Badge className={getStatusColor(task.status)} variant="secondary">
                        {task.status.replace('_', ' ')}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Project Performance */}
        <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[var(--ff-text-primary)]">
              <Target className="h-5 w-5" />
              Project Performance Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border border-[var(--ff-border-light)] rounded-lg">
                <div>
                  <h4 className="font-medium text-[var(--ff-text-primary)]">Sandton Network Upgrade</h4>
                  <p className="text-sm text-[var(--ff-text-secondary)] mt-1">15 tasks completed • 3 in progress</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-green-400">83%</p>
                  <p className="text-xs text-[var(--ff-text-tertiary)]">Daily target achieved</p>
                </div>
              </div>
              <div className="flex items-center justify-between p-4 border border-[var(--ff-border-light)] rounded-lg">
                <div>
                  <h4 className="font-medium text-[var(--ff-text-primary)]">Midrand Infrastructure</h4>
                  <p className="text-sm text-[var(--ff-text-secondary)] mt-1">10 tasks completed • 5 in progress</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-blue-400">67%</p>
                  <p className="text-xs text-[var(--ff-text-tertiary)]">Daily target achieved</p>
                </div>
              </div>
              <div className="flex items-center justify-between p-4 border border-[var(--ff-border-light)] rounded-lg">
                <div>
                  <h4 className="font-medium text-[var(--ff-text-primary)]">Rosebank Residential</h4>
                  <p className="text-sm text-[var(--ff-text-secondary)] mt-1">7 tasks completed • 4 in progress</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-yellow-400">58%</p>
                  <p className="text-xs text-[var(--ff-text-tertiary)]">Daily target achieved</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

// Prevent static generation to avoid router mounting issues
export const getServerSideProps = async () => {
  return {
    props: {},
  };
};