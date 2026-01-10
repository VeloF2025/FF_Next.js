'use client';

import { Users, UserCheck, CheckCircle } from 'lucide-react';
import { TeamPerformance } from '../types/analytics.types';

interface TeamPerformanceTableProps {
  teamPerformance: TeamPerformance[];
}

export function TeamPerformanceTable({ teamPerformance }: TeamPerformanceTableProps) {
  return (
    <div className="ff-card">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Team Performance</h3>
          <Users className="w-5 h-5 text-[var(--ff-text-tertiary)]" />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-[var(--ff-border-light)]">
                <th className="text-left py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">Team</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">Productivity</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">Tasks Completed</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">Avg Time (hrs)</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">Quality Score</th>
              </tr>
            </thead>
            <tbody>
              {teamPerformance.map((team, index) => (
                <tr key={index} className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-hover)]">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-blue-500/20 rounded-full flex items-center justify-center">
                        <UserCheck className="w-4 h-4 text-blue-400" />
                      </div>
                      <span className="font-medium text-[var(--ff-text-primary)]">{team.teamName}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-full max-w-[100px] bg-[var(--ff-bg-tertiary)] rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${
                            team.productivity >= 90 ? 'bg-green-500' :
                            team.productivity >= 80 ? 'bg-yellow-500' :
                            'bg-red-500'
                          }`}
                          style={{ width: `${team.productivity}%` }}
                        />
                      </div>
                      <span className="text-sm text-[var(--ff-text-primary)]">{team.productivity}%</span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-sm text-[var(--ff-text-primary)]">{team.tasksCompleted}</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-sm text-[var(--ff-text-primary)]">{team.avgCompletionTime}</span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1">
                      <span className={`text-sm font-medium ${
                        team.qualityScore >= 95 ? 'text-green-400' :
                        team.qualityScore >= 90 ? 'text-yellow-400' :
                        'text-red-400'
                      }`}>
                        {team.qualityScore}%
                      </span>
                      {team.qualityScore >= 95 && <CheckCircle className="w-4 h-4 text-green-400" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}