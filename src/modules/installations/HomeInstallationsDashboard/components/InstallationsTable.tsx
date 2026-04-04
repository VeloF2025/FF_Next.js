import { User, MapPin, Wifi, Router, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Installation } from '../types/installation.types';
import { getStatusColor, getSpeedQuality } from '../utils/installationUtils';

interface InstallationsTableProps {
  installations: Installation[];
}

export function InstallationsTable({ installations }: InstallationsTableProps) {
  return (
    <div className="ff-card">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-background">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                Installation
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                Customer
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                Technician
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                Equipment
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                Speed Test
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-card divide-y divide-gray-200">
            {installations.map((installation) => (
              <tr key={installation.id}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {installation.homeNumber}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {installation.id}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {installation.clientName}
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center">
                      <MapPin className="w-3 h-3 mr-1" />
                      {installation.address}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(installation.status)}`}>
                    {installation.status.replace('_', ' ')}
                  </span>
                  {installation.issues.length > 0 && (
                    <div className="mt-1 text-xs text-red-600">
                      {installation.issues[0]}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <User className="w-4 h-4 mr-2 text-gray-400" />
                    <span className="text-sm text-foreground">{installation.technician}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex space-x-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      installation.equipment.ont ? 'bg-green-100' : 'bg-secondary'
                    }`}>
                      <Wifi className={`w-4 h-4 ${
                        installation.equipment.ont ? 'text-green-600' : 'text-gray-400'
                      }`} />
                    </div>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      installation.equipment.router ? 'bg-green-100' : 'bg-secondary'
                    }`}>
                      <Router className={`w-4 h-4 ${
                        installation.equipment.router ? 'text-green-600' : 'text-gray-400'
                      }`} />
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {installation.speedTest.download > 0 ? (
                    <div>
                      <div className={`text-sm font-medium ${getSpeedQuality(installation.speedTest.download)}`}>
                        ↓ {installation.speedTest.download} Mbps
                      </div>
                      <div className={`text-xs ${getSpeedQuality(installation.speedTest.upload)}`}>
                        ↑ {installation.speedTest.upload} Mbps
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-gray-400">Pending</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <Button variant="ghost" size="icon" aria-label="More actions">
                    <MoreVertical className="w-5 h-5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}