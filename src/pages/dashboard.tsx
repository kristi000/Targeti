import { useQuery } from "@tanstack/react-query";
import { Navigate, useParams, useSearchParams } from "react-router";

import { BonusesPageClient } from "@/components/bonuses-page-client";
import { DashboardClient } from "@/components/dashboard-client";
import { InsightsClient } from "@/components/insights-client";
import { PageError, PageLoading } from "@/components/page-status";
import { dashboardPeriodsQueryOptions } from "@/lib/dashboard-queries";

export function DashboardPage() {
  const { locale } = useParams();
  const [searchParams] = useSearchParams();
  if (searchParams.get("view") === "bonuses") {
    const month = searchParams.get("month");
    return <Navigate replace to={`/${locale}/bonuses${month ? `?month=${encodeURIComponent(month)}` : ""}`} />;
  }
  return <DashboardClient />;
}

export function BonusesPage() {
  const periodsQuery = useQuery(dashboardPeriodsQueryOptions());
  if (periodsQuery.data) return <BonusesPageClient periods={periodsQuery.data} />;
  return periodsQuery.isError ? <PageError onRetry={() => void periodsQuery.refetch()} /> : <PageLoading />;
}

export function InsightsPage() {
  return <InsightsClient />;
}
