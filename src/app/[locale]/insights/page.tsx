import { resolveReportingMonth } from "@/lib/reporting-month";
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
  const month = resolveReportingMonth(periods, requestedMonth);
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
