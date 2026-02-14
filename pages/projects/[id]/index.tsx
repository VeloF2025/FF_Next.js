import { useState, useEffect } from 'react';
import { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';

// UUID v4 regex for validating project IDs
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ProjectDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const [ProjectDetail, setProjectDetail] = useState<React.ComponentType<{ projectId: string }> | null>(null);

  // Client-side only import (replaces next/dynamic ssr:false which hangs on deployed envs)
  useEffect(() => {
    import('@/pages/ProjectDetail').then(mod => {
      setProjectDetail(() => mod.ProjectDetail || mod.default);
    });
  }, []);

  if (!id || !ProjectDetail) {
    return (
      <AppLayout hideHeader>
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout hideHeader>
      <ProjectDetail projectId={id as string} />
    </AppLayout>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const { id } = ctx.params || {};

  // Validate that id is a valid UUID - prevents catching named routes like /projects/execution
  if (!id || typeof id !== 'string' || !UUID_REGEX.test(id)) {
    return {
      redirect: {
        destination: '/projects',
        permanent: false,
      },
    };
  }

  return { props: {} };
};
