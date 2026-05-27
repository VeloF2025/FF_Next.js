import type { GetServerSideProps, NextPage } from 'next';
import { AppLayout } from '@/components/layout';
import { SerialDrilldownView } from '@/components/field-stock/SerialDrilldownView';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PageProps {
  warehouseId: string;
}

const WarehouseDrilldownPage: NextPage<PageProps> = ({ warehouseId }) => (
  <AppLayout>
    <SerialDrilldownView
      kicker="Warehouse"
      nameField="currentLocationName"
      fallbackHeading={warehouseId}
      fixedFilter={{ warehouseId }}
      backHref="/procurement/field-stock/warehouses"
      backLabel="All warehouses"
    />
  </AppLayout>
);

// UUID-format validation only — no DB read here, so no entity data is exposed
// before the client-side auth gate + gated search API resolve. The warehouse
// name is derived from the authenticated search response.
export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const raw = ctx.params?.warehouseId;
  const warehouseId = Array.isArray(raw) ? raw[0] : raw;
  if (!warehouseId || !UUID_RE.test(warehouseId)) {
    return { notFound: true };
  }
  return { props: { warehouseId } };
};

export default WarehouseDrilldownPage;
