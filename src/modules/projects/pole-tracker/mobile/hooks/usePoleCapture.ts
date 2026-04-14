import { useState, useRef } from 'react';
import { PoleData, DropData, PoleStatus } from '../../types/pole-tracker.types';
import { PoleFormData, PhotoCapture, REQUIRED_PHOTOS } from '../types/poleCapture.types';
import { log } from '@/lib/logger';

export function usePoleCapture(projectId: string) {
  const [formData, setFormData] = useState<PoleFormData>({
    projectId,
    poleNumber: '',
    status: PoleStatus.NOT_STARTED,
    maxDrops: 12,
    currentDrops: 0,
    drops: [],
  });

  const [photos, setPhotos] = useState<PhotoCapture[]>(REQUIRED_PHOTOS);
  const [gpsLocation, setGpsLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isCapturingGPS, setIsCapturingGPS] = useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const captureGPS = () => {
    setIsCapturingGPS(true);
    
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          setGpsLocation(location);
          setFormData((prev) => ({
            ...prev,
            latitude: location.lat,
            longitude: location.lng,
          }));
          setIsCapturingGPS(false);
        },
        (error) => {
          log.error('GPS error:', { data: error }, 'usePoleCapture');
          setIsCapturingGPS(false);
          alert('Unable to get GPS location. Please enable location services.');
        },
        { enableHighAccuracy: true }
      );
    } else {
      alert('GPS not supported on this device');
      setIsCapturingGPS(false);
    }
  };

  const handlePhotoCapture = (index: number) => {
    setActivePhotoIndex(index);
    fileInputRef.current?.click();
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && activePhotoIndex !== null) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const updatedPhotos = [...photos];
        updatedPhotos[activePhotoIndex] = {
          ...updatedPhotos[activePhotoIndex],
          captured: true,
          url: e.target?.result as string,
          file,
        } as PhotoCapture;
        setPhotos(updatedPhotos);
        setActivePhotoIndex(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const addDrop = () => {
    if (formData.currentDrops < formData.maxDrops) {
      const newDrop: DropData = {
        dropNumber: `D${formData.currentDrops + 1}`,
        poleNumber: formData.poleNumber,
        customerName: '',
        address: '',
        installationType: 'aerial',
        status: 'pending',
      };
      
      setFormData((prev) => ({
        ...prev,
        drops: [...prev.drops, newDrop],
        currentDrops: prev.currentDrops + 1,
      }));
    }
  };

  const updateDrop = (index: number, field: keyof DropData, value: string) => {
    const updatedDrops = [...formData.drops];
    updatedDrops[index] = { ...updatedDrops[index], [field]: value } as DropData;
    setFormData((prev) => ({ ...prev, drops: updatedDrops }));
  };

  const validateAndPrepareSaveData = (): Partial<PoleData> | null => {
    // Validate required fields
    if (!formData.poleNumber) {
      alert('Pole number is required');
      return null;
    }

    if (!gpsLocation) {
      alert('GPS location is required');
      return null;
    }

    const requiredPhotosComplete = photos.filter(p => p.required).every(p => p.captured);
    if (!requiredPhotosComplete) {
      alert('Please capture all required photos');
      return null;
    }

    // Convert form data to PoleData format
    const poleData: Partial<PoleData> = {
      vfPoleId: formData.poleNumber,
      projectId: formData.projectId,
      projectCode: '',
      poleNumber: formData.poleNumber,
      dateInstalled: new Date(),
      location: `${formData.latitude || 0}, ${formData.longitude || 0}`,
      poleType: 'wooden' as PoleData['poleType'],
      contractorId: '',
      workingTeam: '',
      dropCount: formData.currentDrops,
      maxCapacity: formData.maxDrops,
      connectedDrops: formData.drops.map(d => d.dropNumber),
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: '',
      updatedBy: '',
    };
    
    // Add optional fields
    if (formData.status) {
      poleData.status = formData.status.toString();
    }
    
    if (formData.latitude && formData.longitude) {
      poleData.gpsCoordinates = {
        latitude: formData.latitude,
        longitude: formData.longitude,
      };
    }

    return poleData;
  };

  const allRequiredComplete = 
    formData.poleNumber && 
    gpsLocation && 
    photos.filter(p => p.required).every(p => p.captured);

  return {
    formData,
    setFormData,
    photos,
    gpsLocation,
    isCapturingGPS,
    fileInputRef,
    allRequiredComplete,
    captureGPS,
    handlePhotoCapture,
    handleFileSelect,
    addDrop,
    updateDrop,
    validateAndPrepareSaveData
  };
}