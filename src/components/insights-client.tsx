"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { type Column, type ColumnDef, type SortingState, flexRender, getCoreRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, ArrowUpDown, Building2, CalendarDays, CircleDollarSign, Gauge, Lightbulb, Loader2, RefreshCw, Search, Users, UserRoundCog, type LucideIcon } from "lucide-react";

import { fetchInsightsPerformance } from "@/app/insights-actions";
import { AppSelect } from "@/components/ui/app-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { dashboardPeriodsQueryOptions } from "@/lib/dashboard-queries";
import { getInsightsPeriod, parseInsightsView, type InsightsPerformance, type InsightsPerformanceRow, type InsightsView } from "@/lib/insights";
import { insightsPerformanceQueryKey } from "@/lib/query-keys";
import { formatReportingMonth, resolveReportingMonth } from "@/lib/reporting-month";
import { cn } from "@/lib/utils";

type Entity = "shops" | "spvs" | "srs";
type RankingRow = InsightsPerformanceRow & { context: string; shopId?: string; revenue: number | null };

function periodLabel(month: string, view: InsightsView, locale: string) {
  const period = getInsightsPeriod(month, view);
  return view === "month" ? formatReportingMonth(month, locale) : view === "quarter" ? `Q${Math.ceil(Number(month.slice(5)) / 3)} ${month.slice(0, 4)}` : period.key;
}

export function InsightsClient() {
  const t = useTranslations("Insights");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [navigating, startNavigation] = useTransition();
  const periodsQuery = useQuery(dashboardPeriodsQueryOptions());
  const periods = useMemo(() => periodsQuery.data ?? [], [periodsQuery.data]);
  const requestedMonth = searchParams.get("month");
  const activeMonth = resolveReportingMonth(periods, requestedMonth);
  const view = parseInsightsView(searchParams.get("view"));
  const period = getInsightsPeriod(activeMonth, view);
  const requestedEntity = searchParams.get("group");
  const entity: Entity = requestedEntity === "spvs" || requestedEntity === "srs" ? requestedEntity : "shops";

  const periodOptions = useMemo(() => {
    const options = new Map<string, { value: string; label: string }>();
    periods.forEach(({ month }) => {
      const key = getInsightsPeriod(month, view).key;
      if (!options.has(key)) options.set(key, { value: month, label: periodLabel(month, view, locale) });
    });
    return [...options.values()];
  }, [periods, view, locale]);
  const selectedPeriod = periodOptions.find(option => getInsightsPeriod(option.value, view).key === period.key)?.value ?? activeMonth;

  const insightsQuery = useQuery({
    queryKey: insightsPerformanceQueryKey(activeMonth, view),
    queryFn: () => fetchInsightsPerformance({ month: activeMonth, view }),
    staleTime: 60_000,
    enabled: periodsQuery.data !== undefined,
  });
  const data = insightsQuery.data;
  const hasData = Boolean(data?.reportingMonths);
  const currency = useMemo(() => new Intl.NumberFormat(locale, { style: "currency", currency: "ALL", useGrouping: false, maximumFractionDigits: 0 }), [locale]);

  const changePeriod = (month: string, nextView = view) => {
    const parameters = new URLSearchParams(searchParams.toString());
    parameters.set("month", month);
    parameters.set("view", nextView);
    startNavigation(() => router.replace(`${pathname}?${parameters}`, { scroll: false }));
  };
  const changeEntity = (next: string) => {
    const parameters = new URLSearchParams(searchParams.toString());
    parameters.set("group", next);
    window.history.replaceState(null, "", `${pathname}?${parameters}`);
  };
  const retry = () => { void periodsQuery.refetch(); void insightsQuery.refetch(); };
  const busy = navigating || insightsQuery.isFetching;

  return (
    <main className="min-h-full min-w-0 overflow-y-auto bg-muted/20 p-3 md:p-4" aria-busy={busy}>
      <div className="mx-auto max-w-[1920px] space-y-4">
        <header className="flex items-center gap-3">
          <SidebarTrigger className="h-9 w-9 shrink-0" />
          <div><h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1><p className="text-sm text-muted-foreground">{t("description")}</p></div>
        </header>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2">
          <div role="group" aria-label={t("view")} className="flex max-w-full gap-1 rounded-md bg-muted p-1">
            {(["month", "quarter", "year"] as const).map(option => <Button key={option} type="button" size="sm" variant="ghost" aria-pressed={view === option} disabled={navigating} onClick={() => changePeriod(activeMonth, option)} className={cn("h-8 px-3 text-xs", view === option ? "bg-background text-foreground shadow-sm hover:bg-background" : "text-muted-foreground")}>{t(option)}</Button>)}
          </div>
          <AppSelect aria-label={t("period")} value={selectedPeriod} options={periodOptions.length ? periodOptions : [{ value: activeMonth, label: periodLabel(activeMonth, view, locale) }]} onValueChange={month => changePeriod(month)} disabled={navigating || !periodOptions.length} className="w-44 bg-background" />
          <Button type="button" size="icon" variant="ghost" aria-label={t("refresh")} title={t("refresh")} disabled={busy || periodsQuery.isFetching} onClick={retry} className="ml-auto h-9 w-9"><RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} /></Button>
        </div>

        {(periodsQuery.isError || insightsQuery.isError) && <div role="alert" className="flex items-center gap-3 rounded-md border border-destructive/30 bg-background p-3 text-sm"><p className="flex-1 text-destructive">{t("error")}</p><Button variant="outline" size="sm" onClick={retry}>{t("retry")}</Button></div>}
        {(!data || navigating) && !insightsQuery.isError && !periodsQuery.isError && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("loading")}</p>}

        {data && <>
          <section className="overflow-hidden rounded-lg border bg-background shadow-sm" aria-labelledby="kpi-insights-heading">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-3">
              <div className="flex items-center gap-2"><span className="rounded bg-primary/10 p-1.5 text-primary"><Lightbulb className="h-4 w-4" /></span><h2 id="kpi-insights-heading" className="font-semibold">{t("overview")}</h2></div>
              <span className="text-sm font-medium text-muted-foreground">{periodLabel(activeMonth, view, locale)}</span>
            </div>
            <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-4">
              <InsightCard label={t("averageAchievement")} value={hasData ? `${data.summary.average.toFixed(1)}%` : "—"} detail={t(view === "month" ? "reportingShops" : "monthlyAverage")} icon={Gauge} />
              {view === "month"
                ? <InsightCard label={t("eomForecast")} value={!hasData ? "—" : data.summary.allFinal ? t("final") : data.summary.forecast === null ? "—" : `${data.summary.forecast.toFixed(1)}%`} detail={t(data.summary.allFinal ? "completedMonth" : "currentPace")} icon={CalendarDays} />
                : <InsightCard label={t("monthsReported")} value={`${data.reportingMonths} / ${period.months.length}`} detail={t("finalMonths", { count: data.finalMonths })} icon={CalendarDays} />}
              <InsightCard label={t("totalRevenue")} value={hasData ? currency.format(data.summary.revenue) : "—"} detail={t("reportedRevenue")} icon={CircleDollarSign} />
              <InsightCard label={t("reportingShops")} value={String(data.summary.activeShops)} detail={t("atTarget", { count: data.summary.shopsAtTarget })} icon={Building2} />
            </div>
          </section>

          <div className="rounded-md border bg-background px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            <p>{t("calculation")}</p><p>{t("coverage", { count: data.reportingMonths, total: period.months.length, final: data.finalMonths })} <span className="font-medium text-foreground">{t("legend")}</span></p>
          </div>

          <Tabs value={entity} onValueChange={changeEntity} className="min-w-0">
            <TabsList aria-label={t("rankings")} className="mb-3 h-11 max-w-full justify-start gap-1 overflow-x-auto">
              <TabsTrigger value="shops" className="gap-2"><Building2 className="h-4 w-4" />{t("shops")}<span className="text-xs text-muted-foreground">{data.shopRows.length}</span></TabsTrigger>
              <TabsTrigger value="spvs" className="gap-2"><UserRoundCog className="h-4 w-4" />{t("spvs")}<span className="text-xs text-muted-foreground">{data.supervisorRows.length}</span></TabsTrigger>
              <TabsTrigger value="srs" className="gap-2"><Users className="h-4 w-4" />{t("srs")}<span className="text-xs text-muted-foreground">{data.representativeRows.length}</span></TabsTrigger>
            </TabsList>
            <TabsContent value="shops"><PerformanceRanking key={`shops:${period.key}`} data={data} month={activeMonth} entity="shops" currency={currency} /></TabsContent>
            <TabsContent value="spvs"><PerformanceRanking key={`spvs:${period.key}`} data={data} month={activeMonth} entity="spvs" currency={currency} /></TabsContent>
            <TabsContent value="srs"><PerformanceRanking key={`srs:${period.key}`} data={data} month={activeMonth} entity="srs" currency={currency} /></TabsContent>
          </Tabs>
        </>}
      </div>
    </main>
  );
}

function PerformanceRanking({ data, month: activeMonth, entity, currency }: { data: InsightsPerformance; month: string; entity: Entity; currency: Intl.NumberFormat }) {
  const t = useTranslations("Insights");
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "achievement", desc: true }]);
  const rows = useMemo<RankingRow[]>(() => {
    if (entity === "shops") return data.shopRows.map(row => ({ ...row, context: row.supervisorNames.join(", ") || t("unassigned") }));
    if (entity === "spvs") return data.supervisorRows.map(row => ({ ...row, context: t("shopCount", { count: row.shopCount }) }));
    return data.representativeRows.map(row => ({ ...row, context: row.shopName, revenue: null }));
  }, [data, entity, t]);
  const filteredRows = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase(locale);
    return normalized ? rows.filter(row => `${row.name} ${row.context}`.toLocaleLowerCase(locale).includes(normalized)) : rows;
  }, [rows, search, locale]);
  const columns = useMemo<ColumnDef<RankingRow>[]>(() => [
    { id: "rank", accessorFn: row => row.rank ?? undefined, header: "#", enableSorting: false, cell: ({ row }) => <span className="text-muted-foreground">{row.original.rank ?? "—"}</span> },
    { id: "name", accessorKey: "name", header: ({ column }) => <SortHeader column={column} label={t(entity === "shops" ? "shop" : entity === "spvs" ? "spv" : "sr")} />, cell: ({ row }) => <div className="min-w-36 max-w-64"><div className="truncate font-medium">{row.original.shopId ? <Link className="hover:underline focus-visible:underline" href={`/${locale}/shop/${row.original.shopId}?month=${activeMonth}`} title={row.original.name}>{row.original.name}</Link> : row.original.name}</div><p className="truncate text-xs font-normal text-muted-foreground" title={row.original.context}>{row.original.context}</p></div> },
    { id: "achievement", accessorFn: row => row.achievement ?? undefined, sortUndefined: "last", header: ({ column }) => <SortHeader column={column} label={t("average")} />, cell: ({ row }) => <span className={cn("font-semibold", row.original.achievement !== null && row.original.achievement >= 100 && "text-emerald-700 dark:text-emerald-400")}>{percentage(row.original.achievement)}{row.original.finalMonths < row.original.reportingMonths && <span className="ml-1 text-amber-600 dark:text-amber-400" aria-label={t("inProgress")}>•</span>}</span> },
    ...(data.period.view === "month" ? [] : data.period.months.map(month => ({
      id: month,
      accessorFn: (row: RankingRow) => row.months.find(value => value.month === month)?.achievement ?? undefined,
      sortUndefined: "last" as const,
      header: ({ column }: { column: Column<RankingRow> }) => <SortHeader column={column} label={new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`))} />,
      cell: ({ row }: { row: { original: RankingRow } }) => {
        const value = row.original.months.find(value => value.month === month);
        const provisional = value?.achievement !== null && value?.achievement !== undefined && !value.isFinal;
        return <span title={t(provisional ? "inProgress" : value?.achievement === null || !value ? "noData" : "final")}>{percentage(value?.achievement ?? null)}{provisional && <span className="ml-1 text-amber-600 dark:text-amber-400" aria-label={t("inProgress")}>•</span>}</span>;
      },
    }))),
    { id: "coverage", accessorKey: "reportingMonths", header: ({ column }) => <SortHeader column={column} label={t("months")} />, cell: ({ row }) => <span title={t("rowCoverage", { count: row.original.reportingMonths, total: data.period.months.length, final: row.original.finalMonths })}>{row.original.reportingMonths}/{data.period.months.length}</span> },
    ...(entity === "srs" ? [] : [{ id: "revenue", accessorFn: (row: RankingRow) => row.achievement === null ? undefined : row.revenue ?? undefined, sortUndefined: "last" as const, header: ({ column }: { column: Column<RankingRow> }) => <SortHeader column={column} label={t("revenue")} />, cell: ({ row }: { row: { original: RankingRow } }) => row.original.achievement === null || row.original.revenue === null ? "—" : currency.format(row.original.revenue) }]),
  ], [data.period, activeMonth, entity, locale, currency, t]);
  const table = useReactTable({ data: filteredRows, columns, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), autoResetPageIndex: false, state: { sorting }, onSortingChange: setSorting });

  return <section className="min-w-0 overflow-hidden rounded-lg border bg-background shadow-sm" aria-label={t(entity)}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 px-3 py-3">
      <div><h2 className="text-sm font-semibold">{t(entity === "shops" ? "shopRankings" : entity === "spvs" ? "spvRankings" : "srRankings")}</h2><p className="text-xs text-muted-foreground">{t("results", { count: filteredRows.length })}</p></div>
      <div className="relative w-full sm:w-72"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} maxLength={120} aria-label={t("search")} placeholder={t("search")} className="h-9 bg-background pl-9" /></div>
    </div>
    <div className="max-h-[65vh] overflow-auto">
      <table className="w-full border-collapse whitespace-nowrap text-xs tabular-nums">
        <thead className="sticky top-0 z-10 bg-muted">{table.getHeaderGroups().map(group => <tr key={group.id}>{group.headers.map(header => <th key={header.id} scope="col" aria-sort={header.column.getIsSorted() === "asc" ? "ascending" : header.column.getIsSorted() === "desc" ? "descending" : undefined} className={cn("border-b border-r px-3 py-2 text-right font-medium last:border-r-0", header.id === "rank" && "sticky left-0 z-20 w-10 min-w-10 max-w-10 bg-muted", header.id === "name" && "sticky left-10 z-20 bg-muted text-left", header.id === "achievement" && "bg-primary/5")}>{flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}</thead>
        <tbody>{table.getRowModel().rows.map(row => <tr key={row.original.id} className="group even:bg-muted/30 hover:bg-muted/60">{row.getVisibleCells().map(cell => <td key={cell.id} className={cn("border-b border-r px-3 py-2 text-right last:border-r-0", cell.column.id === "rank" && "sticky left-0 z-[1] w-10 min-w-10 max-w-10 bg-background group-even:bg-muted group-hover:bg-muted", cell.column.id === "name" && "sticky left-10 z-[1] bg-background text-left group-even:bg-muted group-hover:bg-muted", cell.column.id === "achievement" && "bg-primary/5")}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody>
      </table>
      {!filteredRows.length && <p className="px-4 py-12 text-center text-sm text-muted-foreground">{t(search ? "noMatches" : "empty")}</p>}
    </div>
    {entity === "spvs" && <p className="border-t px-3 py-2 text-xs text-muted-foreground">{t("spvCalculation")}</p>}
    {entity === "srs" && <p className="border-t px-3 py-2 text-xs text-muted-foreground">{t("srCalculation")}</p>}
  </section>;
}

function percentage(value: number | null) { return value === null ? "—" : `${value.toFixed(1)}%`; }

function SortHeader({ column, label }: { column: Column<RankingRow>; label: string }) {
  const t = useTranslations("Insights");
  const sorted = column.getIsSorted();
  const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
  return <button type="button" onClick={column.getToggleSortingHandler()} aria-label={t("sortBy", { column: label })} className="inline-flex items-center gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{label}<Icon className={cn("h-3 w-3", !sorted && "text-muted-foreground/60")} /></button>;
}

function InsightCard({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: LucideIcon }) {
  return <Card className="min-w-0"><CardContent className="flex min-h-24 items-center gap-3 p-4"><span className="rounded-md bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div></CardContent></Card>;
}
