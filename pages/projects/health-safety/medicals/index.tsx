/**
 * Health & Safety Medical Fitness
 * /projects/health-safety/medicals - Redirect to the main medical register page
 * (Full implementation at /health-safety/medicals)
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/health-safety/medicals',
      permanent: false,
    },
  };
};

export default function MedicalsRedirect() {
  return null;
}
