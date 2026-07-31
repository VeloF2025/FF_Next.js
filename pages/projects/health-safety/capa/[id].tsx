/**
 * H&S CAPA detail
 * /projects/health-safety/capa/[id] - Redirect to the main CAPA detail page
 * (Full implementation at /health-safety/capa/[id])
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const id = typeof ctx.params?.id === 'string' ? ctx.params.id : '';
  return {
    redirect: {
      // Carry the id through; a bare /health-safety/capa would silently drop it.
      destination: id ? `/health-safety/capa/${encodeURIComponent(id)}` : '/health-safety/capa',
      permanent: false,
    },
  };
};

export default function CapaDetailRedirect() {
  return null;
}
