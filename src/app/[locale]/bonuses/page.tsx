import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { BonusesPageClient } from "@/components/bonuses-page-client";
import { dashboardPeriodsQueryKey } from "@/lib/query-keys";
import { getDashboardPeriods } from "@/lib/server/dashboard-loaders";

export default async function BonusesPage() {
  const periods = await getDashboardPeriods();
  const queryClient = new QueryClient();
  queryClient.setQueryData(dashboardPeriodsQueryKey, periods);
  return <HydrationBoundary state={dehydrate(queryClient)}><BonusesPageClient periods={periods} /></HydrationBoundary>;
}
