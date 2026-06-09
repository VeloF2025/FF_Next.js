import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { activateConfig } from '@/modules/navigation';
import { SiteCamAppealsQueue } from '@/modules/activate/components/SiteCamAppealsQueue';

const SiteCamAppealsPage: NextPage = () => {
  return (
    <AppLayout>
      <ModulePage config={activateConfig}>
        <div className="mx-auto max-w-3xl">
          <SiteCamAppealsQueue />
        </div>
      </ModulePage>
    </AppLayout>
  );
};

export default SiteCamAppealsPage;
