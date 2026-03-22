import { Clock, Users, Calendar, Plus, TrendingUp, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/router';
import { useState } from 'react';

export function TasksDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('all');

  const tabs = [
    { id: 'all', label: 'All Tasks', count: 48 },
    { id: 'my-tasks', label: 'My Tasks', count: 12 },
    { id: 'team-tasks', label: 'Team Tasks', count: 36 },
    { id: 'completed', label: 'Completed', count: 102 },
  ];

  const cards = [
    {
      title: 'Create Task',
      description: 'Add a new task',
      icon: Plus,
      color: 'bg-blue-500',
      onClick: () => router.push('/app/tasks/new'),
    },
    {
      title: 'In Progress',
      description: 'Tasks currently being worked on',
      icon: Clock,
      color: 'bg-yellow-500',
      count: 8,
      onClick: () => router.push('/app/tasks/in-progress'),
    },
    {
      title: 'Overdue',
      description: 'Tasks past their due date',
      icon: AlertTriangle,
      color: 'bg-red-500',
      count: 3,
      onClick: () => router.push('/app/tasks/overdue'),
    },
    {
      title: 'By Project',
      description: 'Tasks grouped by project',
      icon: TrendingUp,
      color: 'bg-green-500',
      onClick: () => router.push('/app/tasks/by-project'),
    },
    {
      title: 'By Assignee',
      description: 'Tasks grouped by person',
      icon: Users,
      color: 'bg-purple-500',
      onClick: () => router.push('/app/tasks/by-assignee'),
    },
    {
      title: 'Calendar View',
      description: 'View tasks on calendar',
      icon: Calendar,
      color: 'bg-indigo-500',
      onClick: () => router.push('/app/tasks/calendar'),
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Task Management</h1>
        <p className="text-[var(--ff-text-secondary)] mt-1">Create, assign and track tasks across projects</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-[var(--ff-border-light)] mb-6">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                py-2 px-1 border-b-2 font-medium text-sm transition-colors
                ${activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
                }
              `}
            >
              {tab.label}
              <span className="ml-2 py-0.5 px-2 rounded-full bg-[var(--ff-bg-tertiary)] text-xs">
                {tab.count}
              </span>
            </button>
          ))}
        </nav>
      </div>

      {/* Navigation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {cards.map((card) => (
          <div
            key={card.title}
            onClick={card.onClick}
            className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6 hover:shadow-md transition-shadow cursor-pointer"
          >
            <div className="flex items-start space-x-4">
              <div className={`${card.color} p-3 rounded-lg`}>
                <card.icon className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-1">
                  {card.title}
                  {card.count !== undefined && (
                    <span className="ml-2 text-sm font-normal text-[var(--ff-text-secondary)]">
                      ({card.count})
                    </span>
                  )}
                </h3>
                <p className="text-sm text-[var(--ff-text-secondary)]">{card.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Task List Preview */}
      <div className="mt-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Recent Tasks</h2>
          <button className="text-sm text-blue-600 hover:text-blue-700">
            View all →
          </button>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)]">
          <div className="p-6">
            <p className="text-[var(--ff-text-secondary)] text-center">No tasks to display</p>
          </div>
        </div>
      </div>
    </div>
  );
}