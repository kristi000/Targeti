import { fetchDashboardInsights } from "@/app/dashboard-actions";
import { InsightsClient } from "@/components/insights-client";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { dashboardInsightsQueryKey, dashboardPeriodsQueryKey } from "@/lib/query-keys";
import { getDashboardPeriods } from "@/lib/server/dashboard-loaders";

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  const parameters = await searchParams;
  const periods = await getDashboardPeriods();
  const requestedMonth = Array.isArray(parameters.month) ? parameters.month[0] : parameters.month;
  const month = periods.some(period => period.month === requestedMonth)
    ? requestedMonth!
    : periods[0]?.month ?? new Date().toISOString().slice(0, 7);
  const queryClient = new QueryClient();
  queryClient.setQueryData(dashboardPeriodsQueryKey, periods);
  await queryClient.prefetchQuery({
    queryKey: dashboardInsightsQueryKey(month),
    queryFn: () => fetchDashboardInsights(month),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <InsightsClient />
    </HydrationBoundary>
  );
}
