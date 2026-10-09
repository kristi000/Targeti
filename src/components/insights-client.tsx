"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CircleDollarSign,
  Gauge,
  Lightbulb,
  type LucideIcon,
} from "lucide-react";

import { fetchDashboardPeriods } from "@/app/dashboard-actions";
import { fetchDashboardInsights, type DashboardSummary } from "@/app/dashboard-actions";
import { useShop } from "@/components/shop-provider";
import { Card, CardContent } from "@/components/ui/card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { formatReportingDate, formatReportingMonth } from "@/lib/reporting-month";
import { dashboardInsightsQueryKey, dashboardPeriodsQueryKey } from "@/lib/query-keys";

const EMPTY_SUMMARY: DashboardSummary = {
  average: 0,
  forecast: null,
  revenue: 0,
  allFinal: false,
  activeShops: 0,
  shopsAtTarget: 0,
};

export function InsightsClient() {
  const { shops } = useShop();
  const locale = useLocale();
  const searchParams = useSearchParams();

  const periodsQuery = useQuery({ queryKey: dashboardPeriodsQueryKey, queryFn: fetchDashboardPeriods, staleTime: 60_000 });
  const periods = useMemo(() => (periodsQuery.data ?? []).map(period => ({
    id: period.month,
    name: period.reportDate ? formatReportingDate(period.reportDate, locale) : formatReportingMonth(period.month, locale),
  })), [periodsQuery.data, locale]);
  const requestedMonth = searchParams.get("month");
  const activeMonth = periods.some(period => period.id === requestedMonth)
    ? requestedMonth!
    : periods[0]?.id ?? new Date().toISOString().slice(0, 7);

  const insightsQuery = useQuery({
    queryKey: dashboardInsightsQueryKey(activeMonth),
    queryFn: () => fetchDashboardInsights(activeMonth),
    enabled: shops.length > 0,
  });
  const summary = insightsQuery.data ?? EMPTY_SUMMARY;
  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "ALL", useGrouping: false, maximumFractionDigits: 0 });

  return (
    <main className="min-h-full overflow-y-auto bg-muted/20 p-3 md:p-4">
      <div className="mx-auto max-w-[1920px] space-y-4">
        <header className="flex items-center gap-3">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="h-9 w-9 shrink-0" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
              <p className="text-sm text-muted-foreground">Key performance indicators across all shops.</p>
            </div>
          </div>
        </header>

        <section className="overflow-hidden rounded-lg border border-border bg-background shadow-sm" aria-labelledby="kpi-insights-heading">
          <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
            <span className="rounded bg-amber-500 p-1.5 text-white"><Lightbulb className="h-4 w-4" /></span>
            <div>
              <h2 id="kpi-insights-heading" className="font-semibold text-foreground">Performance overview</h2>
              <p className="text-xs text-muted-foreground">Summary for the selected reporting period</p>
            </div>
          </div>
          <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-4">
            <InsightCard label="Overall achievement" value={`${summary.average.toFixed(1)}%`} detail="All reporting locations" icon={Gauge} />
            <InsightCard label="EOM forecast" value={summary.allFinal ? "Final" : summary.forecast === null ? "—" : `${summary.forecast.toFixed(1)}%`} detail={summary.allFinal ? "Completed month" : "Based on current pace"} icon={ArrowUpRight} trend={summary.forecast === null ? undefined : `${(summary.forecast - summary.average).toFixed(1)} pts projected`} positive={summary.forecast !== null && summary.forecast >= summary.average} />
            <InsightCard label="Total revenue" value={currency.format(summary.revenue)} detail="All reporting locations" icon={CircleDollarSign} />
            <InsightCard label="Active shops" value={String(summary.activeShops)} detail="Reporting locations" icon={Building2} trend={`${summary.shopsAtTarget} at or above 100%`} positive />
          </div>
          {insightsQuery.isLoading && <p className="px-4 pb-4 text-sm text-muted-foreground">Loading insights…</p>}
          {insightsQuery.isError && <p className="px-4 pb-4 text-sm text-destructive">Insights could not be loaded. Please refresh to try again.</p>}
          {!shops.length && <p className="px-4 pb-4 text-sm text-muted-foreground">Add a shop to start tracking insights.</p>}
        </section>
      </div>
    </main>
  );
}

type InsightCardProps = {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  trend?: string;
  positive?: boolean;
};

function InsightCard({ label, value, detail, icon: Icon, trend, positive }: InsightCardProps) {
  const TrendIcon = positive ? ArrowUpRight : ArrowDownRight;
  return <Card className="min-w-0"><CardContent className="flex min-h-24 items-center gap-3 p-4"><span className="rounded-md bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{value}</p><div className="mt-1 flex min-w-0 items-center gap-1 text-xs"><span className="text-muted-foreground">{detail}</span>{trend && <><span className="text-muted-foreground">·</span><span className={cn("truncate", positive ? "text-emerald-600" : "text-amber-600")}><TrendIcon className="mr-0.5 inline h-3 w-3" />{trend}</span></>}</div></div></CardContent></Card>;
}
