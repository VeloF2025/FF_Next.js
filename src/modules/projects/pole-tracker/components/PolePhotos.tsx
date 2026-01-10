/**
 * Pole Photos Component
 * Displays photo gallery for pole documentation
 */

import { Camera } from 'lucide-react';
import { PolePhoto } from '../types/pole-detail.types';

interface PolePhotosProps {
  photos: PolePhoto[];
}

export function PolePhotos({ photos }: PolePhotosProps) {
  return (
    <div className="ff-photo-gallery">
      {photos.map((photo) => (
        <div key={photo.id} className="ff-photo-card">
          <div className="ff-photo-placeholder">
            <Camera className="w-12 h-12 text-[var(--ff-text-tertiary)]" />
          </div>
          <div className="ff-photo-info">
            <h4 className="ff-photo-title">{photo.type.toUpperCase()}</h4>
            <p className="ff-photo-description">{photo.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}