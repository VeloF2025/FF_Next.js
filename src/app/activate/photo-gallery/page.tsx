/**
 * /activate/photo-gallery → redirect to VLM Learning section
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PhotoGalleryRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/system/vlm-learning/photo-gallery');
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 text-sm text-gray-400">
      Redirecting to VLM Learning…
    </div>
  );
}
