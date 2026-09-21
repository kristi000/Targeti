
import { DashboardClient } from "@/components/dashboard-client";
import { fetchDashboardPage } from "@/app/dashboard-actions";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { getTranslations } from "next-intl/server";
import type { DashboardCursor, DashboardSortKey } from "@/lib/dashboard-types";
import { dashboardPageQueryKey, dashboardPeriodsQueryKey } from "@/lib/query-keys";
import { getDashboardPeriods } from "@/lib/server/dashboard-loaders";

export async function generateMetadata({params}: {params: Promise<{locale: string}>}) {
  const { locale } = await params;
  const t = await getTranslations({locale, namespace: 'Metadata'});
 
  return {
    title: t('title'),
    description: t('description')
  };
}

type DashboardSearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DashboardPage({ searchParams }: { searchParams: DashboardSearchParams }) {
  const parameters = await searchParams;
  const periods = await getDashboardPeriods();
  const requestedMonth = first(parameters.month);
  const month = periods.some(period => period.month === requestedMonth)
    ? requestedMonth!
    : periods[0]?.month ?? new Date().toISOString().slice(0, 7);
  const search = first(parameters.q)?.trim() ?? "";
  const supervisorId = first(parameters.supervisor)?.trim() || null;
  const requestedSort = first(parameters.sort);
  const hasRequestedSort = requestedSort === "shop" || requestedSort === "achievement" || requestedSort === "forecast" || requestedSort === "revenue";
  const sortBy: DashboardSortKey = hasRequestedSort ? requestedSort : "achievement";
  const sortDescending = hasRequestedSort ? first(parameters.dir) === "desc" : true;
  const requestedSize = Number(first(parameters.size));
  const pageSize = [10, 20, 50].includes(requestedSize) ? requestedSize : 10;
  const cursorValue = first(parameters.afterValue);
  const cursorName = first(parameters.afterName);
  const cursorId = first(parameters.afterId);
  const cursor: DashboardCursor | null = cursorValue !== undefined && cursorName && cursorId ? {
    hasData: first(parameters.afterHasData) === "true",
    value: first(parameters.afterType) === "number" ? Number(cursorValue) : cursorValue,
    name: cursorName,
    id: cursorId,
  } : null;
  const queryClient = new QueryClient();
  queryClient.setQueryData(dashboardPeriodsQueryKey, periods);
  const queryKey = dashboardPageQueryKey({ month, search, supervisorId, pageSize, cursor, sortBy, sortDescending });
  await queryClient.prefetchQuery({
    queryKey,
    queryFn: () => fetchDashboardPage({
      month,
      search,
      supervisorId,
      pageSize,
      cursor,
      sortBy,
      sortDirection: sortDescending ? "desc" : "asc",
    }),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DashboardClient />
    </HydrationBoundary>
  );
}
