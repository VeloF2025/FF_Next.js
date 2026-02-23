'use client';

import { useRouter } from 'next/router';
import { MapPin, Camera, CheckCircle, AlertTriangle } from 'lucide-react';
import type { NeonPole } from '../../services/poleTrackerNeonService';
import { getStatusColor, getPhaseColor, getStatusDisplayText, formatPhaseText } from '../utils/poleDisplayUtils';

interface PoleTrackerTableProps {
  poles: NeonPole[];
}

export function PoleTrackerTable({ poles }: PoleTrackerTableProps) {
  const router = useRouter();

  return (
    <div className="ff-table-container">
      <table className="ff-table">
        <thead className="ff-table-header">
          <tr>
            <th className="ff-table-th">Pole ID</th>
            <th className="ff-table-th">Project</th>
            <th className="ff-table-th">Location</th>
            <th className="ff-table-th">Status</th>
            <th className="ff-table-th">Phase</th>
            <th className="ff-table-th">Drops</th>
            <th className="ff-table-th">Quality</th>
            <th className="ff-table-th">Actions</th>
          </tr>
        </thead>
        <tbody className="ff-table-body">
          {poles.map((pole) => (
            <tr key={pole.id} className="ff-table-row">
              <td className="ff-table-td">
                <div>
                  <div className="ff-table-primary">{pole.pole_number}</div>
                  <div className="ff-table-secondary">{pole.project_code || pole.project_id}</div>
                </div>
              </td>
              <td className="ff-table-td">
                <div>
                  <div className="ff-table-primary">{pole.project_id}</div>
                  <div className="ff-table-secondary">Phase {pole.phase}</div>
                </div>
              </td>
              <td className="ff-table-td">
                <div className="ff-table-location">
                  <MapPin className="w-4 h-4 text-gray-400" />
                  <span className="ff-table-primary">{pole.location}</span>
                </div>
              </td>
              <td className="ff-table-td">
                <span className={getStatusColor(pole.status || 'pending')}>
                  {getStatusDisplayText(pole.status || 'pending')}
                </span>
              </td>
              <td className="ff-table-td">
                <span className={`ff-table-primary ${getPhaseColor(pole.phase || 'permission')}`}>
                  {formatPhaseText(pole.phase || 'permission')}
                </span>
              </td>
              <td className="ff-table-td">
                <div className="ff-progress-indicator">
                  <div className="ff-progress-text">
                    {pole.drop_count || 0}/{pole.max_drops || 12}
                  </div>
                  <div className="ff-progress-bar">
                    <div 
                      className="ff-progress-fill"
                      style={{ width: `${((pole.drop_count || 0) / (pole.max_drops || 12)) * 100}%` }}
                    />
                  </div>
                </div>
              </td>
              <td className="ff-table-td">
                <div className="ff-table-icons">
                  {pole.quality_pole_condition && pole.quality_cable_routing && (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  )}
                  {(!pole.quality_pole_condition || !pole.quality_cable_routing) && (
                    <AlertTriangle className="w-4 h-4 text-yellow-500" />
                  )}
                  {(pole.photo_before || pole.photo_after) && (
                    <Camera className="w-4 h-4 text-blue-500" />
                  )}
                </div>
              </td>
              <td className="ff-table-td">
                <button
                  onClick={() => router.push(`/pole-tracker/${pole.id}`)}
                  className="ff-link"
                >
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}