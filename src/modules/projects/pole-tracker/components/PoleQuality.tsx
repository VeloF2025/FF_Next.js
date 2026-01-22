/**
 * Pole Quality Component
 * Displays quality checks and inspection status
 */

import { CheckCircle, AlertTriangle } from 'lucide-react';
import { QualityCheck } from '../types/pole-detail.types';

interface PoleQualityProps {
  qualityChecks: QualityCheck[];
}

export function PoleQuality({ qualityChecks }: PoleQualityProps) {
  return (
    <div className="ff-quality-panel">
      {qualityChecks.map((check) => (
        <div key={check.id} className="ff-quality-item">
          <div className="ff-quality-status">
            {check.status === 'pass' && <CheckCircle className="w-5 h-5 text-green-500" />}
            {check.status === 'pending' && <AlertTriangle className="w-5 h-5 text-yellow-500" />}
          </div>
          <div className="ff-quality-content">
            <h4 className="ff-quality-title">{check.checkType.replace('_', ' ').toUpperCase()}</h4>
            <p className="ff-quality-meta">
              {check.checkedBy ? `Checked by ${check.checkedBy}` : 'Not checked yet'}
              {check.checkedAt && ` on ${check.checkedAt.toISOString().split('T')[0]}`}
            </p>
          </div>
          <div className="ff-quality-badge">
            <span className={`ff-badge ${check.status === 'pass' ? 'ff-badge-success' : 'ff-badge-warning'}`}>
              {check.status.toUpperCase()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}