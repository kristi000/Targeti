import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";

import { fetchBonusSnapshot } from "@/app/actions/bonus";
import { BonusDashboardRoute } from "@/components/bonus-dashboard-route";
import { BonusAccessGate } from "@/components/bonus-access-gate";
import { hasRestrictedAccess } from "@/lib/restricted-access";
import { getPerformanceMonthsByImportRecency } from "@/lib/types";
import { bonusSnapshotQueryKey, shopPerformanceQueryKey } from "@/lib/query-keys";
import { getShopDirectory, getShopPerformance } from "@/lib/server/dashboard-loaders";
import { notFound } from "next/navigation";

export default async function BonusPage({ params }: { params: Promise<{ shopId: string }> }) {
  const { shopId } = await params;
  const directory = await getShopDirectory();
  const shop = directory.shops.find(item => item.id === shopId);
  if (!shop) notFound();
  if (!await hasRestrictedAccess()) return <BonusAccessGate />;

  const queryClient = new QueryClient();
  const performance = await getShopPerformance(shopId);
  queryClient.setQueryData(shopPerformanceQueryKey(shopId), performance);
  const months = getPerformanceMonthsByImportRecency(performance, Object.keys(shop?.monthlyData ?? {}));
  const month = months[0];
  if (month) {
    await queryClient.prefetchQuery({
      queryKey: bonusSnapshotQueryKey(shopId, month),
      queryFn: () => fetchBonusSnapshot(shopId, month),
    });
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <BonusDashboardRoute shopId={shopId} />
    </HydrationBoundary>
  );
}
