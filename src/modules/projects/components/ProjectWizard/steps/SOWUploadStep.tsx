import { SOWUploadSection } from '../../SOWUploadSection';

interface SOWUploadStepProps {
  projectId?: string;
  onUploadComplete?: () => void;
}

export function SOWUploadStep({ projectId, onUploadComplete }: SOWUploadStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-medium text-foreground mb-2">
          Upload Statement of Work
        </h3>
        <p className="text-sm text-muted-foreground mb-6">
          Upload SOW documents to populate project specifications automatically
        </p>
      </div>

      {projectId ? (
        <SOWUploadSection 
          projectId={projectId}
          projectName="New Project"
          onComplete={onUploadComplete || (() => {})}
        />
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          Project must be created before uploading SOW documents
        </div>
      )}
    </div>
  );
}