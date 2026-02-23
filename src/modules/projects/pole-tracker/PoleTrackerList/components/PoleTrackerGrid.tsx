'use client';

import { useRouter } from 'next/router';
import { Camera, CheckCircle, AlertTriangle } from 'lucide-react';
import type { NeonPole } from '../../services/poleTrackerNeonService';
import { getStatusColor, getPhaseColor, getStatusDisplayText, formatPhaseText } from '../utils/poleDisplayUtils';

interface PoleTrackerGridProps {
  poles: NeonPole[];
}

export function PoleTrackerGrid({ poles }: PoleTrackerGridProps) {
  const router = useRouter();

  return (
    <div className="ff-grid-container">
      {poles.map((pole) => (
        <div key={pole.id} className="ff-card">
          <div className="ff-card-header">
            <div>
              <h3 className="ff-card-title">{pole.pole_number}</h3>
              <p className="ff-card-subtitle">{pole.project_code || pole.project_id}</p>
            </div>
            <div className="ff-table-icons">
              {pole.quality_pole_condition && pole.quality_cable_routing && (
                <CheckCircle className="w-5 h-5 text-green-500" />
              )}
              {(!pole.quality_pole_condition || !pole.quality_cable_routing) && (
                <AlertTriangle className="w-5 h-5 text-yellow-500" />
              )}
              {(pole.photo_before || pole.photo_after) && (
                <Camera className="w-5 h-5 text-blue-500" />
              )}
            </div>
          </div>
          
          <div className="ff-card-content">
            <div className="ff-card-field">
              <span className="ff-card-label">Project:</span>
              <span className="ff-card-value">{pole.project_id}</span>
            </div>
            <div className="ff-card-field">
              <span className="ff-card-label">Location:</span>
              <span className="ff-card-value">{pole.location}</span>
            </div>
            <div className="ff-card-field">
              <span className="ff-card-label">Status:</span>
              <span className={getStatusColor(pole.status || 'pending')}>
                {getStatusDisplayText(pole.status || 'pending')}
              </span>
            </div>
            <div className="ff-card-field">
              <span className="ff-card-label">Phase:</span>
              <span className={`ff-card-value ${getPhaseColor(pole.phase || 'permission')}`}>
                {formatPhaseText(pole.phase || 'permission')}
              </span>
            </div>
            <div className="ff-card-field">
              <span className="ff-card-label">Drops:</span>
              <div className="ff-progress-indicator">
                <span className="ff-progress-text">{pole.drop_count || 0}/{pole.max_drops || 12}</span>
                <div className="ff-progress-bar">
                  <div 
                    className="ff-progress-fill"
                    style={{ width: `${((pole.drop_count || 0) / (pole.max_drops || 12)) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
          
          <div className="ff-card-actions">
            <button
              onClick={() => router.push(`/pole-tracker/${pole.id}`)}
              className="ff-button ff-button-primary ff-button-sm"
            >
              View Details
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}