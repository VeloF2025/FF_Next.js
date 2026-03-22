import { TrendingUp, Calendar, FileText, BarChart3, Users, Download } from 'lucide-react';
import { useRouter } from 'next/router';

export function DailyProgressDashboard() {
  const router = useRouter();

  const cards = [
    {
      title: 'Enter Daily KPIs',
      description: 'Submit today\'s progress data',
      icon: FileText,
      color: 'bg-blue-500',
      onClick: () => router.push('/app/daily-progress/entry'),
    },
    {
      title: 'View Progress',
      description: 'Track daily progress trends',
      icon: TrendingUp,
      color: 'bg-green-500',
      onClick: () => router.push('/app/daily-progress/view'),
    },
    {
      title: 'Weekly Summary',
      description: 'Weekly performance overview',
      icon: Calendar,
      color: 'bg-purple-500',
      onClick: () => router.push('/app/daily-progress/weekly'),
    },
    {
      title: 'Monthly Report',
      description: 'Monthly progress analysis',
      icon: BarChart3,
      color: 'bg-orange-500',
      onClick: () => router.push('/app/daily-progress/monthly'),
    },
    {
      title: 'Team Performance',
      description: 'Compare team metrics',
      icon: Users,
      color: 'bg-indigo-500',
      onClick: () => router.push('/app/daily-progress/teams'),
    },
    {
      title: 'Export Reports',
      description: 'Download progress reports',
      icon: Download,
      color: 'bg-pink-500',
      onClick: () => router.push('/app/daily-progress/export'),
    },
  ];

  const kpiSummary = [
    { label: 'Poles Installed Today', value: 0, change: '+0%', positive: true },
    { label: 'Fiber Pulled (km)', value: 0, change: '+0%', positive: true },
    { label: 'Homes Connected', value: 0, change: '+0%', positive: true },
    { label: 'Quality Score', value: 0, change: '+0%', positive: true },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Daily Progress Tracking</h1>
        <p className="text-muted-foreground mt-1">Monitor and report daily KPIs and project progress</p>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {kpiSummary.map((kpi) => (
          <div key={kpi.label} className="bg-card rounded-lg shadow-sm border border-border p-4">
            <p className="text-sm text-muted-foreground mb-1">{kpi.label}</p>
            <div className="flex items-end justify-between">
              <p className="text-2xl font-bold text-foreground">{kpi.value}</p>
              <span className={`text-sm ${kpi.positive ? 'text-green-600' : 'text-red-600'}`}>
                {kpi.change}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Navigation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {cards.map((card) => (
          <div
            key={card.title}
            onClick={card.onClick}
            className="bg-card rounded-lg shadow-sm border border-border p-6 hover:shadow-md transition-shadow cursor-pointer"
          >
            <div className="flex items-start space-x-4">
              <div className={`${card.color} p-3 rounded-lg`}>
                <card.icon className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-foreground mb-1">
                  {card.title}
                </h3>
                <p className="text-sm text-muted-foreground">{card.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Entries */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-foreground mb-4">Recent Progress Entries</h2>
        <div className="bg-card rounded-lg shadow-sm border border-border">
          <div className="p-6">
            <p className="text-muted-foreground text-center">No progress entries found</p>
          </div>
        </div>
      </div>
    </div>
  );
}