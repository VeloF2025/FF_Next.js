/**
 * Health & Safety Training
 * /projects/health-safety/training - Redirect to the main training matrix page
 * (Full implementation at /health-safety/training)
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/health-safety/training',
      permanent: false,
    },
  };
};

export default function TrainingRedirect() {
  return null;
}
