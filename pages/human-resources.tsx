/**
 * Human Resources Redirect
 * /human-resources -> /staff
 *
 * This page redirects to /staff for backwards compatibility
 * and intuitive URL discovery.
 */

import type { GetServerSideProps } from 'next';

export default function HumanResourcesRedirect() {
  // This should never render due to server-side redirect
  return null;
}

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/staff',
      permanent: true, // 301 redirect for SEO
    },
  };
};
