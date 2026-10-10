
import { DashboardClient } from "@/components/dashboard-client";
import { Suspense } from "react";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { dashboardPeriodsQueryKey } from "@/lib/query-keys";
import { getDashboardPeriods } from "@/lib/server/dashboard-loaders";
import { readDashboardView } from "@/lib/dashboard-navigation";
import { dashboardPageQueryOptions } from "@/lib/dashboard-queries";

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
  return (
    <Suspense fallback={<DashboardClient bootstrapPending />}>
      <HydratedDashboard parameters={parameters} />
    </Suspense>
  );
}

async function HydratedDashboard({ parameters }: { parameters: Awaited<DashboardSearchParams> }) {
  const periods = await getDashboardPeriods();
  const view = readDashboardView({ get: name => first(parameters[name]) ?? null });
  const month = periods.some(period => period.month === view.month)
    ? view.month!
    : periods[0]?.month ?? new Date().toISOString().slice(0, 7);
  const queryClient = new QueryClient();
  queryClient.setQueryData(dashboardPeriodsQueryKey, periods);
  await queryClient.prefetchQuery(dashboardPageQueryOptions({ ...view, month }));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DashboardClient />
    </HydrationBoundary>
  );
}
