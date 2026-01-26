/**
 * Health & Safety Audit Detail
 * /projects/health-safety/audits/[auditId] - Redirect to main audit page
 * (Full implementation at /health-safety/audits/[auditId])
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { auditId } = context.params || {};

  return {
    redirect: {
      destination: `/health-safety/audits/${auditId}`,
      permanent: false,
    },
  };
};

export default function AuditRedirect() {
  return null;
}
