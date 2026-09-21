import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";

import { DetailedDashboardRoute } from "@/components/detailed-dashboard-route";
import { shopPerformanceIndexQueryOptions, shopPerformanceMonthQueryOptions } from "@/lib/performance-queries";
import { getPerformanceMonthsByImportRecency } from "@/lib/types";
import { getShopDirectory } from "@/lib/server/dashboard-loaders";
import { notFound } from "next/navigation";

export default async function DetailedDashboardPage({ params, searchParams }: { params: Promise<{ shopId: string }>; searchParams: Promise<{ month?: string | string[] }> }) {
  const { shopId } = await params;
  const parameters = await searchParams;
  const directory = await getShopDirectory();
  const shop = directory.shops.find(item => item.id === shopId);
  if (!shop) notFound();
  const queryClient = new QueryClient();
  const index = await queryClient.fetchQuery(shopPerformanceIndexQueryOptions(shopId));
  const months = getPerformanceMonthsByImportRecency(index, Object.keys(shop.monthlyData ?? {}));
  const requestedMonth = Array.isArray(parameters.month) ? parameters.month[0] : parameters.month;
  const month = requestedMonth && months.includes(requestedMonth)
    ? requestedMonth
    : months[0] ?? new Date().toISOString().slice(0, 7);
  await queryClient.prefetchQuery({
    ...shopPerformanceMonthQueryOptions(shopId, month),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DetailedDashboardRoute shopId={shopId} requestedMonth={requestedMonth && months.includes(requestedMonth) ? requestedMonth : undefined} />
    </HydrationBoundary>
  );
}
