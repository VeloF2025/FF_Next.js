import { GetServerSideProps } from 'next';

/**
 * SOW Import page - redirects to project Documents tab where import is handled.
 * If projectId is provided, goes directly to that project's documents tab.
 * Otherwise, redirects to the projects list.
 */
export default function SOWImportRedirect() {
  return null;
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const projectId = ctx.query.projectId as string | undefined;

  if (projectId) {
    return {
      redirect: {
        destination: `/projects/${projectId}?tab=documents`,
        permanent: false,
      },
    };
  }

  return {
    redirect: {
      destination: '/projects',
      permanent: false,
    },
  };
};
