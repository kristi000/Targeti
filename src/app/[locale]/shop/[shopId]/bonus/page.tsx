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
import { monthSchema, quarterSchema } from "@/lib/persistence-schemas";

export default async function BonusPage({ params, searchParams }: { params: Promise<{ shopId: string }>; searchParams: Promise<{ month?: string | string[]; view?: string | string[]; kind?: string | string[]; period?: string | string[] }> }) {
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
  const requestedView = Array.isArray(parameters.view) ? parameters.view[0] : parameters.view;
  const initialView = requestedView === "quarterly" || requestedView === "history" ? requestedView : "monthly";
  const requestedKind = Array.isArray(parameters.kind) ? parameters.kind[0] : parameters.kind;
  const requestedPeriod = Array.isArray(parameters.period) ? parameters.period[0] : parameters.period;
  const historyDetail = requestedKind === "monthly" && monthSchema.safeParse(requestedPeriod).success
    ? { kind: "monthly" as const, period: requestedPeriod! }
    : requestedKind === "quarterly" && quarterSchema.safeParse(requestedPeriod).success
      ? { kind: "quarterly" as const, period: requestedPeriod! }
      : undefined;
  const month = requestedMonth && months.includes(requestedMonth) ? requestedMonth : months[0];
  if (month && initialView === "monthly") {
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
      <BonusDashboardRoute shopId={shopId} requestedMonth={requestedMonth && months.includes(requestedMonth) ? requestedMonth : undefined} initialView={initialView} historyDetail={historyDetail} />
    </HydrationBoundary>
  );
}
