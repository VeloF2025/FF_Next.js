/**
 * /activate/photo-gallery → redirect to VLM Learning section.
 *
 * The gallery now lives at /system/vlm-learning/photo-gallery. This stub keeps
 * the old URL working for existing links/bookmarks.
 *
 * Pages Router (not src/app) on purpose: the literal /activate/photo-gallery
 * segment takes precedence over the pages/activate/[dropNumber] dynamic route.
 * An App Router page at the same path would be shadowed by [dropNumber] and
 * never render — so the redirect must live here.
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: '/system/vlm-learning/photo-gallery',
    permanent: false,
  },
});

export default function PhotoGalleryRedirect() {
  return null;
}
