/**
 * Daily Progress Redirect
 * /projects/daily-progress -> /projects/progress
 *
 * Redirects alternate URL to the canonical progress page
 */

import type { GetServerSideProps } from 'next';

export default function DailyProgressRedirect() {
  return null;
}

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/projects/progress',
      permanent: true,
    },
  };
};
