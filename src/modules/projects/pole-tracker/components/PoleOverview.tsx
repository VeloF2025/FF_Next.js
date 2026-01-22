/**
 * Pole Overview Component
 * Displays detailed pole information in organized panels
 */

import { PoleDetail } from '../types/pole-detail.types';

interface PoleOverviewProps {
  pole: PoleDetail;
}

export function PoleOverview({ pole }: PoleOverviewProps) {
  return (
    <div className="ff-section-grid">
      <div className="ff-info-panel">
        <h3 className="ff-panel-title">Pole Information</h3>
        <div className="ff-info-grid">
          <div className="ff-info-item">
            <span className="ff-info-label">VF Pole ID:</span>
            <span className="ff-info-value">{pole.vfPoleId}</span>
          </div>
          <div className="ff-info-item">
            <span className="ff-info-label">Pole Number:</span>
            <span className="ff-info-value">{pole.poleNumber}</span>
          </div>
          <div className="ff-info-item">
            <span className="ff-info-label">Type:</span>
            <span className="ff-info-value">{pole.poleType}</span>
          </div>
          <div className="ff-info-item">
            <span className="ff-info-label">Height:</span>
            <span className="ff-info-value">{pole.poleHeight}m</span>
          </div>
          <div className="ff-info-item">
            <span className="ff-info-label">Installation Depth:</span>
            <span className="ff-info-value">{pole.installationDepth}m</span>
          </div>
          <div className="ff-info-item">
            <span className="ff-info-label">Working Team:</span>
            <span className="ff-info-value">{pole.workingTeam}</span>
          </div>
        </div>
      </div>

      <div className="ff-info-panel">
        <h3 className="ff-panel-title">Project Details</h3>
        <div className="ff-info-grid">
          <div className="ff-info-item">
            <span className="ff-info-label">Project:</span>
            <span className="ff-info-value">{pole.projectName}</span>
          </div>
          <div className="ff-info-item">
            <span className="ff-info-label">Project Code:</span>
            <span className="ff-info-value">{pole.projectCode}</span>
          </div>
          <div className="ff-info-item">
            <span className="ff-info-label">Contractor:</span>
            <span className="ff-info-value">{pole.contractorName}</span>
          </div>
          <div className="ff-info-item">
            <span className="ff-info-label">Rate Paid:</span>
            <span className="ff-info-value">R{pole.ratePaid?.toLocaleString()}</span>
          </div>
          <div className="ff-info-item">
            <span className="ff-info-label">Status:</span>
            <span className="ff-badge ff-badge-success">{pole.status}</span>
          </div>
          <div className="ff-info-item">
            <span className="ff-info-label">Phase:</span>
            <span className="ff-badge ff-badge-info">{pole.installationPhase}</span>
          </div>
        </div>
      </div>

      <div className="ff-info-panel">
        <h3 className="ff-panel-title">Location</h3>
        <div className="ff-info-grid">
          <div className="ff-info-item ff-info-item-full">
            <span className="ff-info-label">Address:</span>
            <span className="ff-info-value">{pole.location}</span>
          </div>
          <div className="ff-info-item">
            <span className="ff-info-label">Latitude:</span>
            <span className="ff-info-value">{pole.gpsCoordinates.latitude}</span>
          </div>
          <div className="ff-info-item">
            <span className="ff-info-label">Longitude:</span>
            <span className="ff-info-value">{pole.gpsCoordinates.longitude}</span>
          </div>
          <div className="ff-info-item">
            <span className="ff-info-label">GPS Accuracy:</span>
            <span className="ff-info-value">{pole.gpsCoordinates.accuracy}m</span>
          </div>
        </div>
      </div>

      <div className="ff-info-panel">
        <h3 className="ff-panel-title">Timeline</h3>
        <div className="ff-info-grid">
          <div className="ff-info-item">
            <span className="ff-info-label">Created:</span>
            <span className="ff-info-value">{pole.createdAt.toISOString().split('T')[0]}</span>
          </div>
          <div className="ff-info-item">
            <span className="ff-info-label">Created By:</span>
            <span className="ff-info-value">{pole.createdByName}</span>
          </div>
          <div className="ff-info-item">
            <span className="ff-info-label">Installed:</span>
            <span className="ff-info-value">{pole.dateInstalled.toISOString().split('T')[0]}</span>
          </div>
          <div className="ff-info-item">
            <span className="ff-info-label">Completed:</span>
            <span className="ff-info-value">{pole.actualCompletionDate?.toISOString().split('T')[0]}</span>
          </div>
          <div className="ff-info-item">
            <span className="ff-info-label">Last Updated:</span>
            <span className="ff-info-value">{pole.updatedAt.toISOString().split('T')[0]}</span>
          </div>
          <div className="ff-info-item">
            <span className="ff-info-label">Updated By:</span>
            <span className="ff-info-value">{pole.updatedByName}</span>
          </div>
        </div>
      </div>
    </div>
  );
}