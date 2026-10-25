import { fetchInsightsPerformance } from "@/app/insights-actions";
import { InsightsClient } from "@/components/insights-client";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { insightsPerformanceQueryKey, dashboardPeriodsQueryKey } from "@/lib/query-keys";
import { getDashboardPeriods } from "@/lib/server/dashboard-loaders";
import { parseInsightsView } from "@/lib/insights";

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ month?: string | string[]; view?: string | string[] }> }) {
  const parameters = await searchParams;
  const periods = await getDashboardPeriods();
  const requestedMonth = Array.isArray(parameters.month) ? parameters.month[0] : parameters.month;
  const view = parseInsightsView(Array.isArray(parameters.view) ? parameters.view[0] : parameters.view);
  const month = periods.some(period => period.month === requestedMonth)
    ? requestedMonth!
    : periods[0]?.month ?? new Date().toISOString().slice(0, 7);
  const queryClient = new QueryClient();
  queryClient.setQueryData(dashboardPeriodsQueryKey, periods);
  await queryClient.prefetchQuery({
    queryKey: insightsPerformanceQueryKey(month, view),
    queryFn: () => fetchInsightsPerformance({ month, view }),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <InsightsClient />
    </HydrationBoundary>
  );
}
