"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Banknote, ClipboardCheck, Loader2, MessageSquareText, RotateCcw, TrendingUp, Trophy, Users } from "lucide-react";
import { format, getDaysInMonth, isSameMonth, parseISO, subMonths } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { Header } from "@/components/header";
import { PerformanceTable } from "@/components/performance-table";
import { WorkerPerformanceList } from "@/components/worker-performance-list";
import { SidebarActions } from "@/components/sidebar-actions";
import { ShopPageNav } from "@/components/shop-page-nav";
import { useShop } from "@/components/shop-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { calculateTotalAchievement, cn } from "@/lib/utils";
import { getForecastDate } from "@/lib/forecast";
import { getActivePerformanceData, getMonthlyRepresentatives, getPerformanceDatasetId, getPerformanceMonthsByImportRecency, getPerformanceShopActuals, getShopMetrics, type PerformanceMetric } from "@/lib/types";
import { formatReportingExcelDate, formatReportingMonth } from "@/lib/reporting-month";
import { handleRevertAchievementOverrides } from "@/app/actions";
import { useToast } from "@/hooks/use-toast";

export function DetailedDashboardClient() {
  const { selectedShop, allPerformanceData, allMonthlyTargets, refreshDataForShop, actor } = useShop();
  const t = useTranslations("DetailedDashboard");
  const locale = useLocale();
  const [monthSelection, setMonthSelection] = useState({ shopId: "", month: "" });
  const [versionSelection, setVersionSelection] = useState({ shopId: "", versionId: "active" });
  const [isRevertingAchievements, setIsRevertingAchievements] = useState(false);
  const { toast } = useToast();

  const allData = selectedShop ? allPerformanceData[selectedShop.id] || [] : [];
  const now = new Date();
  const currentMonth = format(now, "yyyy-MM");
  const availableMonths = useMemo(() => {
    const months = getPerformanceMonthsByImportRecency(allData, Object.keys(selectedShop?.monthlyData ?? {}));
    return months.length ? months : [currentMonth];
  }, [allData, selectedShop?.monthlyData, currentMonth]);
  const selectedMonth = monthSelection.shopId === selectedShop?.id && availableMonths.includes(monthSelection.month)
    ? monthSelection.month
    : availableMonths[0] ?? format(now, "yyyy-MM");
  const selectedVersionId = versionSelection.shopId === selectedShop?.id ? versionSelection.versionId : "active";
  const monthVersions = useMemo(() => allData
    .filter(entry => entry.importId && entry.date.startsWith(selectedMonth))
    .sort((left, right) => (right.importedAt ?? right.date).localeCompare(left.importedAt ?? left.date)), [allData, selectedMonth]);
  const selectedVersion = selectedVersionId === "active"
    ? undefined
    : monthVersions.find(entry => getPerformanceDatasetId(entry) === selectedVersionId);
  const reportOptions = useMemo(() => availableMonths.flatMap(month => {
    const versions = allData
      .filter(entry => entry.importId && entry.date.startsWith(month))
      .sort((left, right) => (right.importedAt ?? right.date).localeCompare(left.importedAt ?? left.date));
    const activeOption = { value: `active:${month}`, month, versionId: "active", report: versions[0] };
    return [
      activeOption,
      ...versions.slice(1).map(report => ({
        value: getPerformanceDatasetId(report),
        month,
        versionId: getPerformanceDatasetId(report),
        report,
      })),
    ];
  }), [allData, availableMonths]);
  const selectedReportValue = selectedVersion ? selectedVersionId : `active:${selectedMonth}`;
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

  const revertAchievements = async () => {
    if (!selectedShop || !excelReport?.achievementOverride) return;
    setIsRevertingAchievements(true);
    try {
      const result = await handleRevertAchievementOverrides(selectedShop.id, getPerformanceDatasetId(excelReport));
      if (!result.success) throw new Error(result.error);
      await refreshDataForShop(selectedShop.id);
      toast({ title: t("achievementsReverted"), description: t("achievementsRevertedDescription") });
    } catch (error) {
      toast({
        variant: "destructive",
        title: t("achievementRevertFailed"),
        description: error instanceof Error ? error.message : t("tryAgain"),
      });
    } finally {
      setIsRevertingAchievements(false);
    }
  };

  if (!selectedShop || !monthlyTargets) {
    return <div className="flex h-full flex-col"><Header title={t("title")} /><div className="flex-1 p-4 md:p-6 lg:p-8"><Link href={`/${locale}/`} className={cn(buttonVariants({ variant: "outline" }), "mb-4")}><ArrowLeft className="mr-2" />{t("backToOverview")}</Link><p>{t("shopNotFound")}</p></div></div>;
  }

  return (
    <div className="flex h-full flex-col">
      <Header
        title={`${t("title")}: ${selectedShop.name}`}
        actions={<>
          <Link href={`/${locale}/`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0 px-2.5 sm:px-3")}><ArrowLeft className="mr-1.5 h-4 w-4" />{t("backToOverview")}</Link>
          <ShopPageNav shopId={selectedShop.id} active="performance" />
          <Select value={selectedReportValue} onValueChange={value => {
            const option = reportOptions.find(item => item.value === value);
            if (!option) return;
            setMonthSelection({ shopId: selectedShop.id, month: option.month });
            setVersionSelection({ shopId: selectedShop.id, versionId: option.versionId });
          }}>
            <SelectTrigger className="h-9 w-56 shrink-0" aria-label={t("reportingPeriod")}><SelectValue /></SelectTrigger>
            <SelectContent>{reportOptions.map((option, index) => <SelectItem key={option.value} value={option.value}>
              {option.report?.importedAt ? formatReportingExcelDate(option.report.importedAt, locale) : formatReportingMonth(option.month, locale)}
              {option.versionId !== "active" ? ` · ${option.report?.importName ?? `Older import ${index + 1}`}` : ""}
            </SelectItem>)}</SelectContent>
          </Select>
        </>}
      />
      <div className="flex-1 overflow-y-auto p-2 sm:p-3 md:p-4">
        <div className="mx-auto w-full max-w-6xl space-y-2 sm:space-y-3">
          <SidebarActions activeMonth={selectedMonth} />
          {excelReport?.achievementOverride && (
            <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{t("userChangedAchievements")}</p>
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  {t("userChangedAchievementsDescription", {
                    date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(excelReport.achievementOverride.updatedAt)),
                  })}
                </p>
              </div>
              {actor.role !== "viewer" && (
                <Button type="button" variant="outline" size="sm" className="shrink-0 border-amber-400 bg-background/80" onClick={() => void revertAchievements()} disabled={isRevertingAchievements}>
                  {isRevertingAchievements ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                  {t("revertToImported")}
                </Button>
              )}
            </div>
          )}

          <div className="grid gap-2 sm:gap-3 xl:grid-cols-2">
          <Card className="w-full max-w-xl overflow-hidden">
            <CardHeader className="flex-row items-center justify-between space-y-0 px-3 py-2.5 sm:px-4 sm:py-3"><div><CardTitle className="text-sm sm:text-base">{t("totalPerformance")}</CardTitle><CardDescription className="hidden sm:block">{t("overallAchievement")}</CardDescription>{revenue !== undefined && <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground sm:mt-1 sm:gap-1.5 sm:text-xs"><Banknote className="h-3.5 w-3.5" />{t("revenueValue")}: {new Intl.NumberFormat(locale, { style: "currency", currency: "ALL", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(revenue)}{previousRevenue !== null && <MonthChange change={revenue - previousRevenue} />}</p>}</div><div className="flex items-center gap-1.5 sm:gap-2"><Trophy className="h-5 w-5 text-primary sm:h-6 sm:w-6" /><div className="text-right"><p className="text-xl font-bold tracking-tight sm:text-2xl">{monthlyAchievement.toFixed(1)}%</p>{previousAchievement !== null && <MonthChange change={monthlyAchievement - previousAchievement} suffix=" pts" />}</div></div></CardHeader>
            <div className="mx-3 mb-2 flex items-center justify-between rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm sm:mx-4 sm:mb-3">
              <span className="flex items-center gap-2 font-medium text-muted-foreground"><TrendingUp className="h-4 w-4 text-primary" />{t("eomForecast")}</span>
              <span className="font-semibold tabular-nums">{isFinal ? "Final" : totalPerformanceForecast === null ? t("notAvailable") : `${totalPerformanceForecast.toFixed(1)}%`}</span>
            </div>
            <CardContent className="space-y-2 px-2 pb-2 sm:space-y-3 sm:px-3 sm:pb-3">
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

function MonthChange({ change, suffix = "" }: { change: number; suffix?: string }) {
  const Icon = change >= 0 ? ArrowUpRight : ArrowDownRight;
  return <span className={cn("ml-1 inline-flex items-center gap-0.5 text-[11px] font-medium", change >= 0 ? "text-emerald-700" : "text-rose-700")}><Icon className="h-3 w-3" />{change >= 0 ? "+" : ""}{change.toFixed(suffix ? 1 : 0)}{suffix} vs prior</span>;
}
