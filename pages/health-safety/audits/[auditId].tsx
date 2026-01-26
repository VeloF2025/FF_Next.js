/**
 * H&S Audit Detail redirect
 * /health-safety/audits/[auditId] → /projects/health-safety/audits/[auditId]
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { auditId } = context.params || {};

  return {
    redirect: {
      destination: `/projects/health-safety/audits/${auditId}`,
      permanent: true,
    },
  };
};

export default function AuditDetailRedirect() {
  return null;
}
