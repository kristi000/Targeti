"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Banknote, ClipboardCheck, Lightbulb, MessageSquareText, TrendingUp, Trophy, UserRoundSearch, Users } from "lucide-react";
import { format, getDaysInMonth, isSameMonth, parseISO, subMonths } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { Header } from "@/components/header";
import { PerformanceTable } from "@/components/performance-table";
import { WorkerPerformanceList } from "@/components/worker-performance-list";
import { SidebarActions } from "@/components/sidebar-actions";
import { ShopPageNav } from "@/components/shop-page-nav";
import { useShop } from "@/components/shop-provider";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { calculateTotalAchievement, cn } from "@/lib/utils";
import { getForecastDate } from "@/lib/forecast";
import { getActivePerformanceData, getMonthlyRepresentatives, getPerformanceDatasetId, getPerformanceShopActuals, getShopMetrics, type PerformanceMetric } from "@/lib/types";
import { getEqualRepresentativeTargets } from "@/lib/representative-targets";
import { getCustomMetricLabel } from "@/lib/metric-definitions";
import { formatReportingExcelDate, formatReportingMonth } from "@/lib/reporting-month";

export function DetailedDashboardClient() {
  const { selectedShop, allPerformanceData, allMonthlyTargets } = useShop();
  const t = useTranslations("DetailedDashboard");
  const tMetric = useTranslations("Metrics");
  const locale = useLocale();
  const [selectedMonthValue, setSelectedMonthValue] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("active");

  const allData = selectedShop ? allPerformanceData[selectedShop.id] || [] : [];
  const now = new Date();
  const currentMonth = format(now, "yyyy-MM");
  const availableMonths = useMemo(() => {
    const months = Array.from(new Set([
      ...allData.map(entry => entry.date.slice(0, 7)),
      ...Object.keys(selectedShop?.monthlyData ?? {}),
    ])).sort().reverse();
    return months.length ? months : [currentMonth];
  }, [allData, selectedShop?.monthlyData, currentMonth]);
  const latestImportDateByMonth = useMemo(() => new Map(
    getActivePerformanceData(allData).flatMap(entry => entry.importId && entry.importedAt
      ? [[entry.date.slice(0, 7), entry.importedAt] as const]
      : []),
  ), [allData]);
  const selectedMonth = availableMonths.includes(selectedMonthValue) ? selectedMonthValue : availableMonths[0] ?? format(now, "yyyy-MM");
  const monthVersions = useMemo(() => allData
    .filter(entry => entry.importId && entry.date.startsWith(selectedMonth))
    .sort((left, right) => (right.importedAt ?? right.date).localeCompare(left.importedAt ?? left.date)), [allData, selectedMonth]);
  const selectedVersion = selectedVersionId === "active"
    ? undefined
    : monthVersions.find(entry => getPerformanceDatasetId(entry) === selectedVersionId);
  const performanceData = useMemo(() => selectedVersion
    ? [selectedVersion]
    : getActivePerformanceData(allData).filter(day => day.date.startsWith(selectedMonth)), [allData, selectedMonth, selectedVersion]);
  const monthData = selectedShop?.monthlyData?.[selectedMonth];
  const monthlyRepresentatives = selectedVersion
    ? selectedVersion.reps.map(rep => ({ id: rep.repId, name: rep.repName ?? rep.repId }))
    : selectedShop ? getMonthlyRepresentatives(selectedShop, selectedMonth) : [];
  const monthlyTargets = selectedVersion?.targets ?? monthData?.targets ?? (selectedShop ? allMonthlyTargets[selectedShop.id] : undefined);
  const metricSettings = monthData?.metricSettings ?? selectedShop?.metricSettings;
  const metricOrder = monthData?.metricOrder ?? selectedShop?.metricOrder;
  const metrics = useMemo(() => getShopMetrics(selectedShop ? { ...selectedShop, metricSettings, metricOrder } : undefined, monthlyTargets), [selectedShop, monthlyTargets, metricSettings, metricOrder]);
  const monthlyTotals = useMemo(() => getPerformanceShopActuals(performanceData, metrics), [performanceData, metrics]);

  const monthlyAchievement = monthlyTargets
    ? calculateTotalAchievement(monthlyTotals, monthlyTargets, metricSettings)
    : 0;
  const previousMonth = format(subMonths(parseISO(`${selectedMonth}-01`), 1), "yyyy-MM");
  const previousPerformanceData = getActivePerformanceData(allData).filter(day => day.date.startsWith(previousMonth));
  const previousReport = previousPerformanceData.find(entry => entry.importId) ?? previousPerformanceData.at(-1);
  const previousTargets = previousReport?.targets ?? selectedShop?.monthlyData?.[previousMonth]?.targets;
  const previousMetrics = previousTargets ? getShopMetrics(selectedShop ?? undefined, previousTargets) : [];
  const previousAchievement = previousTargets ? calculateTotalAchievement(getPerformanceShopActuals(previousPerformanceData, previousMetrics), previousTargets, selectedShop?.monthlyData?.[previousMonth]?.metricSettings ?? selectedShop?.metricSettings) : null;
  const previousRevenue = previousReport?.revenue ?? selectedShop?.monthlyData?.[previousMonth]?.collection ?? null;
  const excelReport = performanceData.find(entry => entry.importId);
  const revenue = excelReport?.revenue ?? monthData?.collection ?? selectedShop?.revenue;
  const qualityMetrics = excelReport?.qualityMetrics ?? monthData?.qualityMetrics;
  const isFinal = excelReport?.reportType === "completedMonth";
  const forecastDate = excelReport?.reportType === "midMonth" ? getForecastDate(excelReport, now) : now;
  const hasForecast = !isFinal && (excelReport?.reportType === "midMonth" || (isSameMonth(parseISO(`${selectedMonth}-01`), now) && performanceData.length >= 2));
  const forecastData = useMemo(() => {
    if (!hasForecast) return undefined;
    const dayOfMonth = forecastDate.getDate();
    const daysInMonth = getDaysInMonth(forecastDate);
    return metrics.reduce((forecast, metric) => {
      forecast[metric] = dayOfMonth > 0 ? ((monthlyTotals[metric] || 0) / dayOfMonth) * daysInMonth : 0;
      return forecast;
    }, {} as Record<PerformanceMetric, number>);
  }, [hasForecast, monthlyTotals, metrics, forecastDate]);
  const totalPerformanceForecast = forecastData
    ? calculateTotalAchievement(forecastData, monthlyTargets, metricSettings)
    : null;

  const performanceInsights = useMemo(() => {
    if (!monthlyTargets) return { focusMetrics: [] as string[], forecastOnTrack: 0, representativesNeedingAttention: [] as string[] };
    const metricLabel = (metric: PerformanceMetric) => metric.startsWith("custom_")
      ? getCustomMetricLabel(metric, metricSettings)
      : tMetric(metric);
    const focusMetrics = metrics
      .filter(metric => (monthlyTargets[metric] ?? 0) > 0)
      .map(metric => ({ metric, achievement: ((monthlyTotals[metric] ?? 0) / monthlyTargets[metric]) * 100 }))
      .sort((left, right) => left.achievement - right.achievement)
      .slice(0, 3)
      .map(item => metricLabel(item.metric));
    const forecastOnTrack = forecastData
      ? metrics.filter(metric => (monthlyTargets[metric] ?? 0) > 0 && ((forecastData[metric] ?? 0) / monthlyTargets[metric]) * 100 >= 100).length
      : 0;

    const representativeTargets = getEqualRepresentativeTargets(monthlyTargets, metrics, monthlyRepresentatives.length);
    const representativesNeedingAttention = monthlyRepresentatives.map(representative => {
      const totals = metrics.reduce((result, metric) => {
        result[metric] = performanceData.reduce((sum, day) => sum + (day.reps.find(rep => rep.repId === representative.id)?.[metric] ?? 0), 0);
        return result;
      }, {} as Record<PerformanceMetric, number>);
      return { name: representative.name, achievement: calculateTotalAchievement(totals, representativeTargets, metricSettings) };
    }).filter(item => item.achievement < 80).sort((left, right) => left.achievement - right.achievement).map(item => item.name);

    return { focusMetrics, forecastOnTrack, representativesNeedingAttention };
  }, [monthlyTargets, metrics, monthlyTotals, forecastData, monthlyRepresentatives, performanceData, metricSettings, tMetric]);

  if (!selectedShop || !monthlyTargets) {
    return <div className="flex h-full flex-col"><Header title={t("title")} /><div className="flex-1 p-4 md:p-6 lg:p-8"><Link href={`/${locale}/`} className={cn(buttonVariants({ variant: "outline" }), "mb-4")}><ArrowLeft className="mr-2" />{t("backToOverview")}</Link><p>{t("shopNotFound")}</p></div></div>;
  }

  return (
    <div className="flex h-full flex-col">
      <Header title={`${t("title")}: ${selectedShop.name}`} />
      <div className="flex-1 overflow-y-auto p-2 sm:p-3 md:p-4">
        <div className="space-y-2 sm:space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Link href={`/${locale}/`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0 px-2.5 sm:px-3")}><ArrowLeft className="mr-1.5 h-4 w-4" />{t("backToOverview")}</Link>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
              <Select value={selectedMonth} onValueChange={value => { setSelectedMonthValue(value); setSelectedVersionId("active"); }}>
                <SelectTrigger className="h-9 min-w-0 flex-1 sm:w-44 sm:flex-none" aria-label={t("reportingPeriod")}><SelectValue /></SelectTrigger>
                <SelectContent>{availableMonths.map(month => {
                  const importedAt = latestImportDateByMonth.get(month);
                  return <SelectItem key={month} value={month}>{importedAt ? formatReportingExcelDate(importedAt, locale) : formatReportingMonth(month, locale)}</SelectItem>;
                })}</SelectContent>
              </Select>
              {monthVersions.length > 1 && <Select value={selectedVersion ? selectedVersionId : "active"} onValueChange={setSelectedVersionId}>
                <SelectTrigger className="h-9 min-w-0 flex-1 sm:w-56 sm:flex-none" aria-label="Import version"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="active">Latest active import</SelectItem>{monthVersions.map((entry, index) => <SelectItem key={getPerformanceDatasetId(entry)} value={getPerformanceDatasetId(entry)}>{index === 0 ? "Latest" : `Older ${index}`} · {entry.importName ?? entry.date}</SelectItem>)}</SelectContent>
              </Select>}
            </div>
          </div>
          <ShopPageNav shopId={selectedShop.id} active="performance" />
          <SidebarActions activeMonth={selectedMonth} />

          <section className="space-y-2 sm:space-y-3" aria-labelledby="performance-insights-heading">
            <div><h2 id="performance-insights-heading" className="text-base font-semibold sm:text-lg">Performance insights</h2><p className="hidden text-sm text-muted-foreground sm:block">The areas that deserve attention in this reporting period.</p></div>
            <div className="grid gap-2 sm:gap-3 md:grid-cols-3">
              <InsightCard icon={Lightbulb} label="Priority metrics" value={performanceInsights.focusMetrics.length ? performanceInsights.focusMetrics.join(", ") : "No target metrics"} detail="Lowest achievement against target" />
              <InsightCard icon={TrendingUp} label="Forecast to target" value={hasForecast ? `${performanceInsights.forecastOnTrack} of ${metrics.length}` : isFinal ? "Completed" : "Not available"} detail={hasForecast ? "Metrics projected to reach 100%" : isFinal ? "This reporting month is final" : "More reporting data is required"} />
              <InsightCard icon={UserRoundSearch} label="Needs attention" value={performanceInsights.representativesNeedingAttention.length ? `${performanceInsights.representativesNeedingAttention.length} representatives` : "No one flagged"} detail={performanceInsights.representativesNeedingAttention.slice(0, 3).join(", ") || "Based on achievement below 80%"} />
            </div>
          </section>

          <div className="grid gap-2 sm:gap-3 xl:grid-cols-2">
          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between space-y-0 px-3 py-2.5 sm:px-4 sm:py-3"><div><CardTitle className="text-sm sm:text-base">{t("totalPerformance")}</CardTitle><CardDescription className="hidden sm:block">{t("overallAchievement")}</CardDescription>{revenue !== undefined && <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground sm:mt-1 sm:gap-1.5 sm:text-xs"><Banknote className="h-3.5 w-3.5" />{t("revenueValue")}: {new Intl.NumberFormat(locale, { style: "currency", currency: "ALL", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(revenue)}{previousRevenue !== null && <MonthChange change={revenue - previousRevenue} />}</p>}</div><div className="flex items-center gap-1.5 sm:gap-2"><Trophy className="h-5 w-5 text-primary sm:h-6 sm:w-6" /><div className="text-right"><p className="text-xl font-bold tracking-tight sm:text-2xl">{monthlyAchievement.toFixed(1)}%</p>{previousAchievement !== null && <MonthChange change={monthlyAchievement - previousAchievement} suffix=" pts" />}</div></div></CardHeader>
            <div className="mx-3 mb-2 flex items-center justify-between rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm sm:mx-4 sm:mb-3">
              <span className="flex items-center gap-2 font-medium text-muted-foreground"><TrendingUp className="h-4 w-4 text-primary" />{t("eomForecast")}</span>
              <span className="font-semibold tabular-nums">{isFinal ? "Final" : totalPerformanceForecast === null ? t("notAvailable") : `${totalPerformanceForecast.toFixed(1)}%`}</span>
            </div>
            <CardContent className="space-y-2 px-2 pb-2 sm:space-y-3 sm:px-3 sm:pb-3">
              <Progress value={monthlyAchievement} className="h-2 sm:h-3" />
              <PerformanceTable
                actuals={monthlyTotals}
                targets={monthlyTargets}
                metricSettings={metricSettings}
                metricOrder={metrics}
                forecasts={forecastData}
                forecastAsOf={hasForecast ? format(forecastDate, "PP") : undefined}
                isFinal={isFinal}
                storageKey={`shop-${selectedShop.id}`}
                caption={t("performanceTable")}
                compact
              />
            </CardContent>
          </Card>

          {qualityMetrics && <Card className="overflow-hidden"><CardHeader className="px-3 py-2.5 sm:px-4 sm:py-3"><CardTitle className="text-sm sm:text-base">Quality indicators</CardTitle><CardDescription className="hidden sm:block">Reported separately from weighted target metrics</CardDescription></CardHeader><CardContent className="grid grid-cols-3 gap-2 px-3 pb-3 sm:gap-3 sm:px-4 sm:pb-4 xl:grid-cols-1 2xl:grid-cols-3">{qualityMetrics.checklistScore !== undefined && <div className="min-w-0 rounded-md border bg-muted/20 p-2 sm:p-3"><p className="flex items-center gap-1 text-[11px] text-muted-foreground sm:gap-1.5 sm:text-xs"><ClipboardCheck className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Checklist</span></p><p className="mt-0.5 text-lg font-semibold tabular-nums sm:mt-1 sm:text-xl">{qualityMetrics.checklistScore.toFixed(1)}</p></div>}{qualityMetrics.npsScore !== undefined && <div className="min-w-0 rounded-md border bg-muted/20 p-2 sm:p-3"><p className="flex items-center gap-1 text-[11px] text-muted-foreground sm:gap-1.5 sm:text-xs"><MessageSquareText className="h-3.5 w-3.5 shrink-0" />NPS</p><p className="mt-0.5 text-lg font-semibold tabular-nums sm:mt-1 sm:text-xl">{qualityMetrics.npsScore.toFixed(1)}</p></div>}{qualityMetrics.npsResponses !== undefined && <div className="min-w-0 rounded-md border bg-muted/20 p-2 sm:p-3"><p className="flex items-center gap-1 text-[11px] text-muted-foreground sm:gap-1.5 sm:text-xs"><Users className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Responses</span></p><p className="mt-0.5 text-lg font-semibold tabular-nums sm:mt-1 sm:text-xl">{qualityMetrics.npsResponses}</p></div>}</CardContent></Card>}

          {monthlyRepresentatives.length ? <WorkerPerformanceList salesRepresentatives={monthlyRepresentatives} performanceData={performanceData} monthlyTargets={monthlyTargets} metricSettings={metricSettings} metricOrder={metrics} shopId={selectedShop.id} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

type InsightCardProps = { icon: typeof Lightbulb; label: string; value: string; detail: string };

function MonthChange({ change, suffix = "" }: { change: number; suffix?: string }) {
  const Icon = change >= 0 ? ArrowUpRight : ArrowDownRight;
  return <span className={cn("ml-1 inline-flex items-center gap-0.5 text-[11px] font-medium", change >= 0 ? "text-emerald-700" : "text-rose-700")}><Icon className="h-3 w-3" />{change >= 0 ? "+" : ""}{change.toFixed(suffix ? 1 : 0)}{suffix} vs prior</span>;
}

function InsightCard({ icon: Icon, label, value, detail }: InsightCardProps) {
  return <Card className="min-w-0 overflow-hidden"><CardContent className="flex min-w-0 items-center gap-2 p-2.5 sm:items-start sm:gap-3 sm:p-4"><span className="h-fit shrink-0 rounded-md bg-primary/10 p-1.5 text-primary sm:rounded-lg sm:p-2"><Icon className="h-4 w-4" /></span><div className="min-w-0 flex-1"><div className="flex min-w-0 items-baseline justify-between gap-2 sm:block"><p className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">{label}</p><p className="min-w-0 truncate text-sm font-semibold sm:mt-1 sm:line-clamp-2 sm:text-base">{value}</p></div><p className="mt-1 hidden truncate text-xs text-muted-foreground sm:block" title={detail}>{detail}</p></div></CardContent></Card>;
}
