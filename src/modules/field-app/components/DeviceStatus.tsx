import { Battery, Signal, HardDrive, Smartphone } from 'lucide-react';
import { cn } from '@/utils/cn';

interface DeviceStatusProps {
  battery: number;
  signal: 'excellent' | 'good' | 'fair' | 'poor';
  gpsAccuracy: number;
  storage: { used: number; total: number };
}

export function DeviceStatus({ battery, signal, gpsAccuracy, storage }: DeviceStatusProps) {
  const getBatteryColor = (level: number) => {
    if (level > 50) return 'text-green-400';
    if (level > 20) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getSignalColor = (strength: string) => {
    switch (strength) {
      case 'excellent': return 'text-green-400';
      case 'good': return 'text-blue-400';
      case 'fair': return 'text-yellow-400';
      case 'poor': return 'text-red-400';
      default: return 'text-[var(--ff-text-secondary)]';
    }
  };

  const getSignalBars = (strength: string) => {
    switch (strength) {
      case 'excellent': return 4;
      case 'good': return 3;
      case 'fair': return 2;
      case 'poor': return 1;
      default: return 0;
    }
  };

  const storagePercentage = (storage.used / storage.total) * 100;

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
      <h3 className="font-medium text-[var(--ff-text-primary)] mb-4 flex items-center">
        <Smartphone className="w-4 h-4 mr-2" />
        Device Status
      </h3>

      <div className="grid grid-cols-2 gap-4">
        {/* Battery */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Battery className={cn("w-4 h-4 mr-2", getBatteryColor(battery))} />
              <span className="text-sm font-medium">Battery</span>
            </div>
            <span className={cn("text-sm font-semibold", getBatteryColor(battery))}>
              {battery}%
            </span>
          </div>
          <div className="w-full bg-[var(--ff-bg-tertiary)] rounded-full h-2">
            <div
              className={cn(
                "h-2 rounded-full",
                battery > 50 ? "bg-green-500" :
                battery > 20 ? "bg-yellow-500" : "bg-red-500"
              )}
              style={{ width: `${battery}%` }}
            />
          </div>
        </div>

        {/* Signal */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Signal className={cn("w-4 h-4 mr-2", getSignalColor(signal))} />
              <span className="text-sm font-medium">Signal</span>
            </div>
            <span className={cn("text-sm font-semibold capitalize", getSignalColor(signal))}>
              {signal}
            </span>
          </div>
          <div className="flex items-end space-x-1">
            {[1, 2, 3, 4].map((bar) => (
              <div
                key={bar}
                className={cn(
                  "w-2 bg-[var(--ff-bg-tertiary)] rounded-sm",
                  bar <= getSignalBars(signal) ? getSignalColor(signal).replace('text-', 'bg-') : ''
                )}
                style={{ height: `${bar * 3 + 4}px` }}
              />
            ))}
          </div>
        </div>

        {/* GPS */}
        <div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">GPS Accuracy</span>
            <span className="text-sm font-semibold">±{gpsAccuracy}m</span>
          </div>
        </div>

        {/* Storage */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <HardDrive className="w-4 h-4 mr-2" />
              <span className="text-sm font-medium">Storage</span>
            </div>
            <span className="text-sm font-semibold">
              {storage.used.toFixed(1)} / {storage.total}GB
            </span>
          </div>
          <div className="w-full bg-[var(--ff-bg-tertiary)] rounded-full h-2">
            <div
              className={cn(
                "h-2 rounded-full",
                storagePercentage > 80 ? "bg-red-500" :
                storagePercentage > 60 ? "bg-yellow-500" : "bg-green-500"
              )}
              style={{ width: `${storagePercentage}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}