

interface SOWUploadWizardProps {
  projectName?: string;
  onComplete?: () => void;
}

export function SOWUploadWizard({ projectName = 'Project' }: SOWUploadWizardProps) {
  return (
    <div className="p-6 bg-[var(--ff-bg-card)] rounded-lg shadow-sm border border-[var(--ff-border-light)]">
      <p className="text-lg text-[var(--ff-text-primary)]">Checking import status for {projectName}...</p>
      <p className="text-sm text-[var(--ff-text-secondary)] mt-2">SOW Upload functionality is being configured.</p>
    </div>
  );
}

export default SOWUploadWizard;
