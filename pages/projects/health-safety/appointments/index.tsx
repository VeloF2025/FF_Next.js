/**
 * Health & Safety Appointment Letters
 * /projects/health-safety/appointments - Redirect to the main appointments page
 * (Full implementation at /health-safety/appointments)
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/health-safety/appointments',
      permanent: false,
    },
  };
};

export default function AppointmentsRedirect() {
  return null;
}
