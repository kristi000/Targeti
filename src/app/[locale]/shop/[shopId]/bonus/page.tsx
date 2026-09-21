import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";

import { fetchBonusSnapshot } from "@/app/actions/bonus";
import { BonusDashboardRoute } from "@/components/bonus-dashboard-route";
import { BonusAccessGate } from "@/components/bonus-access-gate";
import { hasRestrictedAccess } from "@/lib/restricted-access";
import { shopPerformanceIndexQueryOptions, shopPerformanceMonthQueryOptions } from "@/lib/performance-queries";
import { getPerformanceMonthsByImportRecency } from "@/lib/types";
import { bonusSnapshotQueryKey } from "@/lib/query-keys";
import { getShopDirectory } from "@/lib/server/dashboard-loaders";
import { notFound } from "next/navigation";

export default async function BonusPage({ params, searchParams }: { params: Promise<{ shopId: string }>; searchParams: Promise<{ month?: string | string[] }> }) {
  const { shopId } = await params;
  const parameters = await searchParams;
  const directory = await getShopDirectory();
  const shop = directory.shops.find(item => item.id === shopId);
  if (!shop) notFound();
  if (!await hasRestrictedAccess()) return <BonusAccessGate />;

  const queryClient = new QueryClient();
  const index = await queryClient.fetchQuery(shopPerformanceIndexQueryOptions(shopId));
  const months = getPerformanceMonthsByImportRecency(index, Object.keys(shop.monthlyData ?? {}));
  const requestedMonth = Array.isArray(parameters.month) ? parameters.month[0] : parameters.month;
  const month = requestedMonth && months.includes(requestedMonth) ? requestedMonth : months[0];
  if (month) {
    await Promise.all([
      queryClient.prefetchQuery(shopPerformanceMonthQueryOptions(shopId, month)),
      queryClient.prefetchQuery({
        queryKey: bonusSnapshotQueryKey(shopId, month),
        queryFn: () => fetchBonusSnapshot(shopId, month),
      }),
    ]);
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <BonusDashboardRoute shopId={shopId} requestedMonth={requestedMonth && months.includes(requestedMonth) ? requestedMonth : undefined} />
    </HydrationBoundary>
  );
}
