import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { Badge } from '@/shared/components/ui/Badge';
import { Calendar, Clock, MapPin, User, AlertCircle } from 'lucide-react';

interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignedTo?: string;
  technicianName?: string;
  scheduledDate: string;
  location?: {
    address: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  estimatedDuration?: number;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/field/tasks');
      if (!response.ok) throw new Error('Failed to fetch tasks');
      const data = await response.json();
      setTasks(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-500/20 text-green-400';
      case 'in_progress': return 'bg-blue-500/20 text-blue-400';
      case 'pending': return 'bg-yellow-500/20 text-yellow-400';
      case 'cancelled': return 'bg-gray-500/20 text-gray-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-[var(--ff-text-secondary)]">Loading tasks...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto" />
            <p className="mt-4 text-red-400">{error}</p>
            <Button onClick={fetchTasks} className="mt-4">
              Retry
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Field Tasks</h1>
          <Button onClick={fetchTasks}>
            Refresh
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tasks.map((task) => (
            <Card key={task.id} className="hover:shadow-lg transition-shadow bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-lg text-[var(--ff-text-primary)]">{task.title}</CardTitle>
                  <Badge className={getPriorityColor(task.priority)}>
                    {task.priority}
                  </Badge>
                </div>
                <Badge className={getStatusColor(task.status)} variant="secondary">
                  {task.status.replace('_', ' ')}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {task.description && (
                  <p className="text-sm text-[var(--ff-text-secondary)] line-clamp-2">
                    {task.description}
                  </p>
                )}

                <div className="space-y-2 text-sm">
                  {task.technicianName && (
                    <div className="flex items-center gap-2 text-[var(--ff-text-secondary)]">
                      <User className="h-4 w-4" />
                      <span>{task.technicianName}</span>
                    </div>
                  )}

                  {task.scheduledDate && (
                    <div className="flex items-center gap-2 text-[var(--ff-text-secondary)]">
                      <Calendar className="h-4 w-4" />
                      <span>{new Date(task.scheduledDate).toLocaleDateString()}</span>
                    </div>
                  )}

                  {task.estimatedDuration && (
                    <div className="flex items-center gap-2 text-[var(--ff-text-secondary)]">
                      <Clock className="h-4 w-4" />
                      <span>{task.estimatedDuration} hours</span>
                    </div>
                  )}

                  {task.location?.address && (
                    <div className="flex items-center gap-2 text-[var(--ff-text-secondary)]">
                      <MapPin className="h-4 w-4" />
                      <span className="line-clamp-1">{task.location.address}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {tasks.length === 0 && (
          <div className="text-center py-12">
            <p className="text-[var(--ff-text-secondary)]">No tasks found</p>
          </div>
        )}
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