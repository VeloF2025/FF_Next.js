import type { NextPage } from 'next';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ZoneDeliveryWorkspacePage } from '@/modules/construction-qa/zone-delivery/components/ZoneDeliveryWorkspacePage';
import { constructionQaConfig } from '@/modules/navigation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (value: string | string[] | undefined): string | null =>
  typeof value === 'string' ? value : null;

const ZonePage: NextPage = () => {
  const router = useRouter();
  const projectId = one(router.query.project_id);
  const zoneValue = one(router.query.zone_no);
  const zoneNo = zoneValue === null ? Number.NaN : Number(zoneValue);
  const valid = projectId !== null && UUID.test(projectId)
    && zoneValue !== null && /^[1-9]\d*$/.test(zoneValue) && Number.isSafeInteger(zoneNo);

  return (
    <AppLayout>
      <Head><title>Zone Delivery | FibreFlow</title></Head>
      <ModulePage config={constructionQaConfig}>
        {!router.isReady ? (
          <div className="py-16"><LoadingSpinner label="Loading zone link" /></div>
        ) : valid ? (
          <ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo }} />
        ) : (
          <div role="alert" className="rounded-lg border border-amber-500/40 p-5">
            <h1 className="font-semibold">This zone link is invalid.</h1>
            <p className="mt-1 text-sm">Use a link from the Zone delivery register.</p>
            <a href="/field-ops" className="mt-3 inline-block underline">Back to zone register</a>
          </div>
        )}
      </ModulePage>
    </AppLayout>
  );
};

export default ZonePage;
