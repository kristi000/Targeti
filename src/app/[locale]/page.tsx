
import { DashboardClient } from "@/components/dashboard-client";
import { fetchDashboardPage } from "@/app/dashboard-actions";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import type { DashboardSortKey } from "@/lib/dashboard-types";
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

export default async function DashboardPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: DashboardSearchParams }) {
  const parameters = await searchParams;
  if (first(parameters.view) === "bonuses") {
    const { locale } = await params;
    const requestedMonth = first(parameters.month);
    const query = requestedMonth ? `?month=${encodeURIComponent(requestedMonth)}` : "";
    redirect(`/${locale}/bonuses${query}`);
  }
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
  const queryClient = new QueryClient();
  queryClient.setQueryData(dashboardPeriodsQueryKey, periods);
  const queryKey = dashboardPageQueryKey({ month, search, supervisorId, sortBy, sortDescending });
  await queryClient.prefetchQuery({
    queryKey,
    queryFn: () => fetchDashboardPage({
      month,
      search,
      supervisorId,
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
