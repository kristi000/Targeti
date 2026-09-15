import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";

import { DetailedDashboardRoute } from "@/components/detailed-dashboard-route";
import { shopPerformanceQueryKey } from "@/lib/query-keys";
import { getShopPerformance } from "@/lib/server/dashboard-loaders";
import { getShopDirectory } from "@/lib/server/dashboard-loaders";
import { notFound } from "next/navigation";

export default async function DetailedDashboardPage({ params }: { params: Promise<{ shopId: string }> }) {
  const { shopId } = await params;
  const directory = await getShopDirectory();
  if (!directory.shops.some(shop => shop.id === shopId)) notFound();
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery({
    queryKey: shopPerformanceQueryKey(shopId),
    queryFn: () => getShopPerformance(shopId),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DetailedDashboardRoute shopId={shopId} />
    </HydrationBoundary>
  );
}
