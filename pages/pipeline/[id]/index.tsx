/**
 * Pipeline project detail redirect
 * /pipeline/[id] → /projects/pipeline/[id]
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { id } = context.params || {};

  return {
    redirect: {
      destination: `/projects/pipeline/${id}`,
      permanent: true,
    },
  };
};

export default function PipelineDetailRedirect() {
  return null;
}
