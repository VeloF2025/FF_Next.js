// ============= Stats Cards Component =============

import { Paper, Typography } from '@mui/material';
import { Grid3x3, Cable, MapPin, Link } from 'lucide-react';

interface StatsCardsProps {
  polesCount: number;
  fibreCount: number;
  dropsCount: number;
  onemapCount: number;
  nokiaCount: number;
}

export function StatsCards({
  polesCount,
  fibreCount,
  dropsCount,
  onemapCount,
  nokiaCount
}: StatsCardsProps) {
  return (
    <div className="grid grid-cols-5 gap-4 mb-6">
      <Paper className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <Typography variant="h6">{polesCount}</Typography>
            <Typography variant="body2" color="textSecondary">SOW Poles</Typography>
          </div>
          <MapPin className="h-8 w-8 text-orange-500" />
        </div>
      </Paper>

      <Paper className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <Typography variant="h6">{fibreCount}</Typography>
            <Typography variant="body2" color="textSecondary">Fibre Segments</Typography>
          </div>
          <Cable className="h-8 w-8 text-blue-500" />
        </div>
      </Paper>

      <Paper className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <Typography variant="h6">{dropsCount}</Typography>
            <Typography variant="body2" color="textSecondary">SOW Drops</Typography>
          </div>
          <Link className="h-8 w-8 text-green-500" />
        </div>
      </Paper>

      <Paper className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <Typography variant="h6">{onemapCount}</Typography>
            <Typography variant="body2" color="textSecondary">OneMap Records</Typography>
          </div>
          <Grid3x3 className="h-8 w-8 text-purple-500" />
        </div>
      </Paper>

      <Paper className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <Typography variant="h6">{nokiaCount}</Typography>
            <Typography variant="body2" color="textSecondary">Nokia Drops</Typography>
          </div>
          <Cable className="h-8 w-8 text-red-500" />
        </div>
      </Paper>
    </div>
  );
}
