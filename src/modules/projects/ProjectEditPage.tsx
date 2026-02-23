'use client';

import { ProjectForm } from './components/ProjectForm';
import { useRouter } from 'next/router';

export function ProjectEditPage() {
  const router = useRouter();
  
  const handleSubmit = () => {
    // TODO: Implement project update
    router.push('/projects');
  };
  
  const handleCancel = () => {
    router.push('/projects');
  };
  
  return (
    <div className="p-6">
      <ProjectForm 
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </div>
  );
}