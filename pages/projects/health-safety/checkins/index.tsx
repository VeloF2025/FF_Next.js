/**
 * H&S Daily Check-ins
 * /projects/health-safety/checkins - Redirect to the main page
 * (Full implementation at /health-safety/checkins)
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/health-safety/checkins',
      permanent: false,
    },
  };
};

export default function CheckinsRedirect() {
  return null;
}
