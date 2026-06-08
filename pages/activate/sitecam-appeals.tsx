import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { SiteCamAppealsQueue } from '@/modules/activate/components/SiteCamAppealsQueue';

const SiteCamAppealsPage: NextPage = () => {
  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl px-4 py-6 space-y-4">
        <h1 className="text-xl font-bold text-neutral-800">SiteCam Appeals</h1>
        <SiteCamAppealsQueue />
      </div>
    </AppLayout>
  );
};

export default SiteCamAppealsPage;
