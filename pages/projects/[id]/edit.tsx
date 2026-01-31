import { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';

const ProjectForm = dynamic(() => import('@/modules/projects/components/ProjectForm').then(mod => mod.ProjectForm || mod.default), {
  ssr: false,
  loading: () => <div>Loading...</div>
});

export default function EditProjectPage() {
  const router = useRouter();
  const { id } = router.query;
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      // Fetch project data
      fetch(`/api/projects/${id}`)
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setProject(data.data);
          } else {
            console.error('Failed to fetch project:', data.error);
          }
        })
        .catch(err => {
          console.error('Error fetching project:', err);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [id]);

  const handleSubmit = (projectData: any) => {
    // Handle project update
    fetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(projectData),
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          router.push('/projects');
        } else {
          console.error('Failed to update project:', data.error);
        }
      })
      .catch(err => {
        console.error('Error updating project:', err);
      });
  };

  const handleCancel = () => {
    router.push('/projects');
  };

  if (loading || !id) return <div>Loading...</div>;

  return <ProjectForm project={project} onSubmit={handleSubmit} onCancel={handleCancel} />;
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  return { props: {} };
};