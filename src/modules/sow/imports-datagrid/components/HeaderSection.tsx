// ============= Header Section Component =============

import { FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { Grid3x3 } from 'lucide-react';
import type { Project, MatchingMode } from '../types/types';

interface HeaderSectionProps {
  projectId: string;
  projects: Project[];
  matchingMode: MatchingMode;
  onProjectChange: (projectId: string) => void;
  onMatchingModeChange: (mode: MatchingMode) => void;
}

export function HeaderSection({
  projectId,
  projects,
  matchingMode,
  onProjectChange,
  onMatchingModeChange
}: HeaderSectionProps) {
  return (
    <div className="flex justify-between items-center mb-8">
      <div className="flex items-center">
        <Grid3x3 className="h-8 w-8 text-blue-600 mr-3" />
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Imports Data Grid</h1>
          <p className="text-gray-600 dark:text-gray-400">View SOW and OneMap field data imports</p>
        </div>
      </div>

      <div className="flex gap-4">
        {/* Matching Mode Selector */}
        <FormControl sx={{ minWidth: 180 }}>
          <InputLabel>Matching Mode</InputLabel>
          <Select
            value={matchingMode}
            label="Matching Mode"
            onChange={(e) => onMatchingModeChange(e.target.value as MatchingMode)}
          >
            <MenuItem value="enhanced">Enhanced (Smart)</MenuItem>
            <MenuItem value="exact">Exact Only</MenuItem>
          </Select>
        </FormControl>

        {/* Project Selector */}
        <FormControl sx={{ minWidth: 250 }}>
          <InputLabel>Select Project</InputLabel>
          <Select
            value={projectId}
            label="Select Project"
            onChange={(e) => onProjectChange(e.target.value)}
          >
            {projects.map(project => (
              <MenuItem key={project.id} value={project.id}>
                {project.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </div>
    </div>
  );
}
