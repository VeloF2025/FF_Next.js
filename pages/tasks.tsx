/**
 * Tasks redirect
 * /tasks → /projects/tasks
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/projects/tasks',
      permanent: true,
    },
  };
};

export default function TasksRedirect() {
  return null;
}
