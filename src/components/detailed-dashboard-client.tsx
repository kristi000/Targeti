"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Banknote, ClipboardCheck, MessageSquareText, Trophy, Users } from "lucide-react";
import { format, getDaysInMonth, isSameMonth, parseISO } from "date-fns";
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
import { getActivePerformanceData, getMonthlyRepresentatives, getPerformanceDatasetId, getPerformanceShopActuals, getShopMetrics, type PerformanceMetric } from "@/lib/types";

export function DetailedDashboardClient() {
  const { selectedShop, allPerformanceData, allMonthlyTargets } = useShop();
  const t = useTranslations("DetailedDashboard");
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
  const excelReport = performanceData.find(entry => entry.importId);
  const revenue = excelReport?.revenue ?? monthData?.collection ?? selectedShop?.revenue;
  const qualityMetrics = excelReport?.qualityMetrics ?? monthData?.qualityMetrics;
  const isFinal = excelReport?.reportType === "completedMonth";
  const forecastDate = excelReport?.reportType === "midMonth" ? parseISO(excelReport.asOfDate ?? excelReport.date) : now;
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

  if (!selectedShop || !monthlyTargets) {
    return <div className="flex h-full flex-col"><Header title={t("title")} /><div className="flex-1 p-4 md:p-6 lg:p-8"><Link href={`/${locale}/`} className={cn(buttonVariants({ variant: "outline" }), "mb-4")}><ArrowLeft className="mr-2" />{t("backToOverview")}</Link><p>{t("shopNotFound")}</p></div></div>;
  }

  return (
    <div className="flex h-full flex-col">
      <Header title={`${t("title")}: ${selectedShop.name}`} />
      <div className="flex-1 overflow-y-auto p-3 md:p-4">
        <div className="space-y-3">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <Link href={`/${locale}/`} className={buttonVariants({ variant: "outline" })}><ArrowLeft className="mr-2" />{t("backToOverview")}</Link>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={selectedMonth} onValueChange={value => { setSelectedMonthValue(value); setSelectedVersionId("active"); }}>
                <SelectTrigger className="w-44" aria-label={t("reportingPeriod")}><SelectValue /></SelectTrigger>
                <SelectContent>{availableMonths.map(month => <SelectItem key={month} value={month}>{format(parseISO(`${month}-01`), "MMMM yyyy")}</SelectItem>)}</SelectContent>
              </Select>
              {monthVersions.length > 1 && <Select value={selectedVersion ? selectedVersionId : "active"} onValueChange={setSelectedVersionId}>
                <SelectTrigger className="w-56" aria-label="Import version"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="active">Latest active import</SelectItem>{monthVersions.map((entry, index) => <SelectItem key={getPerformanceDatasetId(entry)} value={getPerformanceDatasetId(entry)}>{index === 0 ? "Latest" : `Older ${index}`} · {entry.importName ?? entry.date}</SelectItem>)}</SelectContent>
              </Select>}
            </div>
          </div>
          <ShopPageNav shopId={selectedShop.id} active="performance" />
          <SidebarActions activeMonth={selectedMonth} />

          <div className="grid gap-3 xl:grid-cols-2">
          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between space-y-0 px-4 py-3"><div><CardTitle className="text-base">{t("totalPerformance")}</CardTitle><CardDescription>{t("overallAchievement")}</CardDescription>{revenue !== undefined && <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Banknote className="h-3.5 w-3.5" />{t("revenueValue")}: {new Intl.NumberFormat(locale, { style: "currency", currency: "ALL", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(revenue)}</p>}</div><div className="flex items-center gap-2"><Trophy className="h-6 w-6 text-primary" /><p className="text-2xl font-bold tracking-tight">{monthlyAchievement.toFixed(1)}%</p></div></CardHeader>
            <CardContent className="space-y-3 px-3 pb-3">
              <Progress value={monthlyAchievement} className="h-3" />
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

          {qualityMetrics && <Card className="overflow-hidden"><CardHeader className="px-4 py-3"><CardTitle className="text-base">Quality indicators</CardTitle><CardDescription>Reported separately from weighted target metrics</CardDescription></CardHeader><CardContent className="grid gap-3 px-4 pb-4 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">{qualityMetrics.checklistScore !== undefined && <div className="rounded-md border bg-muted/20 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ClipboardCheck className="h-3.5 w-3.5" />Checklist</p><p className="mt-1 text-xl font-semibold tabular-nums">{qualityMetrics.checklistScore.toFixed(1)}</p></div>}{qualityMetrics.npsScore !== undefined && <div className="rounded-md border bg-muted/20 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><MessageSquareText className="h-3.5 w-3.5" />NPS</p><p className="mt-1 text-xl font-semibold tabular-nums">{qualityMetrics.npsScore.toFixed(1)}</p></div>}{qualityMetrics.npsResponses !== undefined && <div className="rounded-md border bg-muted/20 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" />Responses</p><p className="mt-1 text-xl font-semibold tabular-nums">{qualityMetrics.npsResponses}</p></div>}</CardContent></Card>}

          {monthlyRepresentatives.length ? <WorkerPerformanceList salesRepresentatives={monthlyRepresentatives} performanceData={performanceData} monthlyTargets={monthlyTargets} metricSettings={metricSettings} metricOrder={metrics} shopId={selectedShop.id} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
