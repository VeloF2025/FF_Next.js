import React, { useState, useRef } from 'react';
import { Upload, X, Check } from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';

export function VFLogoUpload() {
  const [currentLogo, setCurrentLogo] = useState<string | null>(
    localStorage.getItem('vf-custom-logo')
  );
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      notificationService.warning('Please upload an image file');
      return;
    }

    // Validate file size (max 5MB for larger logos)
    if (file.size > 5 * 1024 * 1024) {
      notificationService.warning('File size must be less than 5MB');
      return;
    }

    setUploading(true);

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      
      // Save to localStorage
      localStorage.setItem('vf-custom-logo', dataUrl);
      setCurrentLogo(dataUrl);
      setUploading(false);
      
      // Reload to apply changes
      window.location.reload();
    };

    reader.onerror = () => {
      notificationService.error('Failed to read file');
      setUploading(false);
    };

    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    localStorage.removeItem('vf-custom-logo');
    setCurrentLogo(null);
    // Reload to apply changes
    window.location.reload();
  };

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4">Application Logo</h3>

      <div className="space-y-4">
        <div className="flex items-center space-x-4">
          <div className="flex-shrink-0">
            <div className="w-20 h-20 rounded-lg bg-[var(--ff-bg-tertiary)] flex items-center justify-center overflow-hidden">
              {currentLogo ? (
                <img 
                  src={currentLogo} 
                  alt="Current VF Logo" 
                  className="w-full h-full object-contain"
                />
              ) : (
                <img 
                  src="/assets/vf/vf-logo.svg" 
                  alt="Default VF Logo" 
                  className="w-full h-full object-contain"
                />
              )}
            </div>
          </div>
          
          <div className="flex-1">
            <p className="text-sm text-[var(--ff-text-secondary)] mb-2">
              Upload a custom logo for the application. Recommended size: 200x200px
            </p>
            <p className="text-xs text-[var(--ff-text-tertiary)]">
              Supported formats: PNG, JPG, SVG (Max 5MB)
            </p>
          </div>
        </div>

        <div className="flex space-x-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
          />
          
          <button
            onClick={handleButtonClick}
            disabled={uploading}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Upload Logo
              </>
            )}
          </button>

          {currentLogo && (
            <button
              onClick={handleRemoveLogo}
              className="flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              <X className="w-4 h-4 mr-2" />
              Remove Custom Logo
            </button>
          )}
        </div>

        {currentLogo && (
          <div className="flex items-center text-green-400">
            <Check className="w-4 h-4 mr-2" />
            <span className="text-sm">Custom logo is active</span>
          </div>
        )}
      </div>
    </div>
  );
}