import { MapPin, Home, Cable } from 'lucide-react';
import { useSOWUpload } from './SOWUploadSection/hooks/useSOWUpload';
import { FileUploadCard } from './SOWUploadSection/components/FileUploadCard';
import { UploadSummary } from './SOWUploadSection/components/UploadSummary';
import { FILE_TYPE_CONFIGS } from './SOWUploadSection/types/sowUpload.types';
import type { SOWUploadSectionProps } from './SOWUploadSection/types/sowUpload.types';
import type { NeonPoleData, NeonDropData, NeonFibreData } from '@/services/neonSOWService';

export function SOWUploadSection({
  projectId,
  onComplete,
  onDataUpdate,
  showActions = true
}: SOWUploadSectionProps) {
  // Cast the onDataUpdate callback to the hook's internal type; both shapes describe the same data
  type SOWDataUpdate = { poles?: NeonPoleData[]; drops?: NeonDropData[]; fibre?: NeonFibreData[] };
  const typedOnDataUpdate = onDataUpdate as ((data: SOWDataUpdate) => void) | undefined;
  const {
    files,
    isProcessing,
    handleFileUpload,
    removeFile,
    downloadTemplate
  } = useSOWUpload(projectId, typedOnDataUpdate);

  // Add icons to file type configs
  const fileTypes = FILE_TYPE_CONFIGS.map(config => ({
    ...config,
    icon: config.type === 'poles' ? MapPin : 
          config.type === 'drops' ? Home : 
          Cable
  }));

  const allFilesUploaded = fileTypes.every(ft => 
    files.find(f => f.type === ft.type && f.status === 'success')
  );

  return (
    <div className="space-y-6">
      {/* File Upload Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {fileTypes.map((fileType) => {
          const uploadedFile = files.find(f => f.type === fileType.type);
          
          return (
            <FileUploadCard
              key={fileType.type}
              fileType={fileType}
              {...(uploadedFile && { uploadedFile })}
              isProcessing={isProcessing}
              onFileUpload={handleFileUpload}
              onRemoveFile={removeFile}
              onDownloadTemplate={() => downloadTemplate(fileType)}
            />
          );
        })}
      </div>

      <UploadSummary
        files={files}
        allFilesUploaded={allFilesUploaded}
        {...(onComplete && { onComplete })}
        showActions={showActions}
      />
    </div>
  );
}