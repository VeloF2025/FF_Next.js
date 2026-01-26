/**
 * Fleet Dashboard Page
 * Overview of fleet vehicles and GPS investigation
 */

import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { fleetConfig } from '@/modules/navigation';
import {
  Car,
  Truck,
  FileSearch,
  MapPin,
  AlertTriangle,
  TrendingUp,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';
import Link from 'next/link';

interface FleetStats {
  totalVehicles: number;
  activeVehicles: number;
  assignedVehicles: number;
  unassignedVehicles: number;
  inMaintenance: number;
  retired: number;
  totalLocations: number;
  recentInvestigations: number;
}

interface RecentInvestigation {
  id: string;
  vehicleRegistration: string;
  createdAt: string;
  status: 'completed' | 'processing' | 'failed';
  totalTrips: number;
  unauthorizedTrips: number;
  unauthorizedCost: number;
}

function FleetDashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-48 mb-2 animate-pulse"></div>
        <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-64 animate-pulse"></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border-light)]">
            <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-20 mb-2 animate-pulse"></div>
            <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-16 mb-1 animate-pulse"></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  href,
}: {
  title: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
  href?: string;
}) {
  const content = (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border-light)] hover:border-[var(--ff-primary)] transition-colors">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-[var(--ff-text-secondary)]">{title}</p>
          <p className="text-2xl font-bold text-[var(--ff-text-primary)] mt-1">{value}</p>
        </div>
        <div className={`p-3 rounded-lg ${color}`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
      </div>
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}

function InvestigationRow({ investigation }: { investigation: RecentInvestigation }) {
  const statusConfig = {
    completed: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-100' },
    processing: { icon: Clock, color: 'text-yellow-500', bg: 'bg-yellow-100' },
    failed: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-100' },
  };
  const status = statusConfig[investigation.status];
  const StatusIcon = status.icon;

  return (
    <Link href={`/fleet/investigation/${investigation.id}`}>
      <div className="flex items-center justify-between p-4 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors cursor-pointer">
        <div className="flex items-center gap-4">
          <div className={`p-2 rounded-lg ${status.bg}`}>
            <StatusIcon className={`w-5 h-5 ${status.color}`} />
          </div>
          <div>
            <p className="font-medium text-[var(--ff-text-primary)]">{investigation.vehicleRegistration}</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              {new Date(investigation.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-medium text-[var(--ff-text-primary)]">
            {investigation.unauthorizedTrips}/{investigation.totalTrips} unauthorized
          </p>
          {investigation.unauthorizedCost > 0 && (
            <p className="text-sm text-red-500">
              R{investigation.unauthorizedCost.toLocaleString()}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function FleetDashboardPage() {
  const [stats, setStats] = useState<FleetStats | null>(null);
  const [recentInvestigations, setRecentInvestigations] = useState<RecentInvestigation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch vehicles stats
        const vehiclesRes = await fetch('/api/fleet/vehicles?limit=1000');
        const vehiclesData = await vehiclesRes.json();

        const vehicles = vehiclesData.data || [];
        const activeVehicles = vehicles.filter((v: any) => v.status === 'active');
        const assignedVehicles = vehicles.filter((v: any) => v.assignedStaffId);
        const inMaintenance = vehicles.filter((v: any) => v.status === 'maintenance');
        const retired = vehicles.filter((v: any) => v.status === 'retired');

        // Fetch locations
        const locationsRes = await fetch('/api/fleet/locations');
        const locationsData = await locationsRes.json();
        const locations = locationsData.data || [];

        // Fetch recent investigations
        const investigationsRes = await fetch('/api/fleet/investigation?limit=5');
        const investigationsData = await investigationsRes.json();
        const investigations = investigationsData.data || [];

        setStats({
          totalVehicles: vehicles.length,
          activeVehicles: activeVehicles.length,
          assignedVehicles: assignedVehicles.length,
          unassignedVehicles: activeVehicles.filter((v: any) => !v.assignedStaffId).length,
          inMaintenance: inMaintenance.length,
          retired: retired.length,
          totalLocations: locations.length,
          recentInvestigations: investigations.length,
        });

        setRecentInvestigations(investigations);
        setLoading(false);
      } catch (err) {
        setError('Failed to load fleet data');
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Header actions for ModulePage
  const headerActions = (
    <div className="flex gap-3">
      <Link href="/fleet/vehicles">
        <button className="px-4 py-2 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] rounded-lg border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] transition-colors flex items-center gap-2">
          <Car className="w-4 h-4" />
          All Vehicles
        </button>
      </Link>
      <Link href="/fleet/investigation">
        <button className="px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] transition-colors flex items-center gap-2">
          <FileSearch className="w-4 h-4" />
          New Investigation
        </button>
      </Link>
    </div>
  );

  if (loading) {
    return (
      <AppLayout>
        <ModulePage config={fleetConfig} headerActions={headerActions} isLoading>
          <FleetDashboardSkeleton />
        </ModulePage>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <ModulePage config={fleetConfig} headerActions={headerActions}>
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
              <p className="text-[var(--ff-text-primary)]">{error}</p>
            </div>
          </div>
        </ModulePage>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <ModulePage config={fleetConfig} headerActions={headerActions}>
        <div className="space-y-6">
          {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Vehicles"
            value={stats?.totalVehicles || 0}
            icon={Truck}
            color="bg-blue-500"
            href="/fleet/vehicles"
          />
          <StatCard
            title="Active Vehicles"
            value={stats?.activeVehicles || 0}
            icon={Car}
            color="bg-green-500"
            href="/fleet/vehicles?status=active"
          />
          <StatCard
            title="Unassigned"
            value={stats?.unassignedVehicles || 0}
            icon={AlertTriangle}
            color="bg-yellow-500"
            href="/fleet/vehicles?assigned=false"
          />
          <StatCard
            title="Authorized Locations"
            value={stats?.totalLocations || 0}
            icon={MapPin}
            color="bg-purple-500"
            href="/fleet/locations"
          />
        </div>

        {/* Recent Investigations */}
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)]">
          <div className="p-6 border-b border-[var(--ff-border-light)]">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Recent Investigations</h2>
              <Link href="/fleet/investigation" className="text-[var(--ff-primary)] hover:underline text-sm">
                View all
              </Link>
            </div>
          </div>
          <div className="divide-y divide-[var(--ff-border-light)]">
            {recentInvestigations.length > 0 ? (
              recentInvestigations.map((investigation) => (
                <InvestigationRow key={investigation.id} investigation={investigation} />
              ))
            ) : (
              <div className="p-8 text-center">
                <FileSearch className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
                <p className="text-[var(--ff-text-secondary)]">No investigations yet</p>
                <Link href="/fleet/investigation">
                  <button className="mt-4 px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] transition-colors">
                    Start First Investigation
                  </button>
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link href="/fleet/vehicles">
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border-light)] hover:border-[var(--ff-primary)] transition-colors cursor-pointer">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <Car className="w-6 h-6 text-blue-500" />
                </div>
                <div>
                  <h3 className="font-medium text-[var(--ff-text-primary)]">Manage Vehicles</h3>
                  <p className="text-sm text-[var(--ff-text-secondary)]">View and edit fleet vehicles</p>
                </div>
              </div>
            </div>
          </Link>
          <Link href="/fleet/locations">
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border-light)] hover:border-[var(--ff-primary)] transition-colors cursor-pointer">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-purple-100 rounded-lg">
                  <MapPin className="w-6 h-6 text-purple-500" />
                </div>
                <div>
                  <h3 className="font-medium text-[var(--ff-text-primary)]">Authorized Locations</h3>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Configure geofencing zones</p>
                </div>
              </div>
            </div>
          </Link>
          <Link href="/fleet/investigation">
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border-light)] hover:border-[var(--ff-primary)] transition-colors cursor-pointer">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-100 rounded-lg">
                  <FileSearch className="w-6 h-6 text-green-500" />
                </div>
                <div>
                  <h3 className="font-medium text-[var(--ff-text-primary)]">GPS Investigation</h3>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Analyze vehicle usage patterns</p>
                </div>
              </div>
            </div>
          </Link>
        </div>
      </div>
      </ModulePage>
    </AppLayout>
  );
}
