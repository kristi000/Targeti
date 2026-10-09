"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowLeft, Banknote, ClipboardCheck, Loader2, MessageSquareText, Pencil, RotateCcw, Save, TrendingUp, Trophy, Users } from "lucide-react";
import { format, isSameMonth, parseISO } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { Header } from "@/components/header";
import { ShopPageToolbar } from "@/components/shop-page-toolbar";
import { PerformanceTable } from "@/components/performance-table";
import { WorkerPerformanceList } from "@/components/worker-performance-list";
import { useShop } from "@/components/shop-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { calculateTotalAchievement, cn } from "@/lib/utils";
import { getForecastDate, projectMetrics } from "@/lib/forecast";
import { getActivePerformanceData, getMonthlyRepresentatives, getPerformanceDatasetId, getPerformanceMonthsByImportRecency, getPerformanceShopActuals, getShopMetrics, type PerformanceData, type PerformanceIndexEntry, type PerformanceMetric, type RepPerformanceData } from "@/lib/types";
import { formatReportingDate, formatReportingMonth } from "@/lib/reporting-month";
import { handleRevertAchievementOverrides, handleSaveAchievementOverrides } from "@/app/actions/achievements";
import { shopPerformanceIndexQueryOptions, shopPerformanceMonthQueryOptions } from "@/lib/performance-queries";
import { useToast } from "@/hooks/use-toast";
import { getEqualRepresentativeTargets } from "@/lib/representative-targets";

const EMPTY_INDEX: PerformanceIndexEntry[] = [];
const EMPTY_PERFORMANCE: PerformanceData[] = [];

export function DetailedDashboardClient({ requestedMonth }: { requestedMonth?: string }) {
  const { selectedShop, allMonthlyTargets, refreshDataForShop, updateShop, actor, selectedDatasetId, setSelectedDatasetId, setSelectedPerformanceId, achievementEditRequest, clearAchievementEditRequest } = useShop();
  const t = useTranslations("DetailedDashboard");
  const locale = useLocale();
  const [monthSelection, setMonthSelection] = useState({ shopId: "", month: "" });
  const [versionSelection, setVersionSelection] = useState({ shopId: "", versionId: "active" });
  const [isRevertingAchievements, setIsRevertingAchievements] = useState(false);
  const [achievementDraft, setAchievementDraft] = useState<{ key: string; reps: RepPerformanceData[] } | null>(null);
  const [isSavingAchievements, setIsSavingAchievements] = useState(false);
  const { toast } = useToast();

  const now = new Date();
  const currentMonth = format(now, "yyyy-MM");
  const indexQuery = useQuery({ ...shopPerformanceIndexQueryOptions(selectedShop?.id ?? ""), enabled: Boolean(selectedShop) });
  const index = indexQuery.data ?? EMPTY_INDEX;
  const availableMonths = useMemo(() => {
    const months = getPerformanceMonthsByImportRecency(index, Object.keys(selectedShop?.monthlyData ?? {}));
    return months.length ? months : [currentMonth];
  }, [index, selectedShop?.monthlyData, currentMonth]);
  const selectedMonth = monthSelection.shopId === selectedShop?.id && availableMonths.includes(monthSelection.month)
    ? monthSelection.month
    : requestedMonth && availableMonths.includes(requestedMonth) ? requestedMonth
    : availableMonths.includes(selectedDatasetId) ? selectedDatasetId : availableMonths[0] ?? format(now, "yyyy-MM");
  const performanceQuery = useQuery({
    ...shopPerformanceMonthQueryOptions(selectedShop?.id ?? "", selectedMonth),
    enabled: Boolean(selectedShop && selectedMonth && !indexQuery.isPending),
  });
  const allData = performanceQuery.data ?? EMPTY_PERFORMANCE;
  const selectedVersionId = versionSelection.shopId === selectedShop?.id ? versionSelection.versionId : "active";
  const monthVersions = useMemo(() => allData
    .filter(entry => entry.importId && entry.date.startsWith(selectedMonth))
    .sort((left, right) => (right.importedAt ?? right.date).localeCompare(left.importedAt ?? left.date)), [allData, selectedMonth]);
  const selectedVersion = selectedVersionId === "active"
    ? undefined
    : monthVersions.find(entry => getPerformanceDatasetId(entry) === selectedVersionId);
  useEffect(() => {
    setSelectedDatasetId(selectedMonth);
    setSelectedPerformanceId(selectedVersionId === "active" ? null : selectedVersionId);
  }, [selectedMonth, selectedVersionId, setSelectedDatasetId, setSelectedPerformanceId]);
  const reportOptions = useMemo(() => availableMonths.flatMap(month => {
    const versions = index
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
  }), [index, availableMonths]);
  const selectedReportValue = selectedVersion ? selectedVersionId : `active:${selectedMonth}`;
  const performanceData = useMemo(() => selectedVersion
    ? [selectedVersion]
    : getActivePerformanceData(allData).filter(day => day.date.startsWith(selectedMonth)), [allData, selectedMonth, selectedVersion]);
  const monthData = selectedShop?.monthlyData?.[selectedMonth];
  const monthlyRepresentatives = useMemo(() => selectedVersion
    ? selectedVersion.reps.map(rep => ({ id: rep.repId, name: rep.repName ?? rep.repId }))
    : selectedShop ? getMonthlyRepresentatives(selectedShop, selectedMonth) : [], [selectedVersion, selectedShop, selectedMonth]);
  const monthlyTargets = selectedVersion?.targets ?? monthData?.targets ?? (selectedShop ? allMonthlyTargets[selectedShop.id] : undefined);
  const metricSettings = selectedVersion?.metricSettings ?? monthData?.metricSettings ?? selectedShop?.metricSettings;
  const metricOrder = selectedVersion?.metricOrder ?? monthData?.metricOrder ?? selectedShop?.metricOrder;
  const representativeTargets = selectedVersion?.representativeTargets ?? monthData?.representativeTargets;
  const metrics = useMemo(() => getShopMetrics(selectedShop ? { ...selectedShop, metricSettings, metricOrder } : undefined, monthlyTargets), [selectedShop, monthlyTargets, metricSettings, metricOrder]);
  const monthlyTotals = useMemo(() => getPerformanceShopActuals(performanceData, metrics), [performanceData, metrics]);

  const excelReport = performanceData.find(entry => entry.importId);
  const initialAchievementReps = useMemo<RepPerformanceData[]>(() => excelReport?.reps.map(rep => ({ ...rep })) ?? monthlyRepresentatives.map(representative => {
    const values = metrics.reduce((totals, metric) => {
      totals[metric] = performanceData.reduce((sum, report) => sum + (report.reps.find(rep => rep.repId === representative.id)?.[metric] ?? 0), 0);
      return totals;
    }, {} as Record<PerformanceMetric, number>);
    return { repId: representative.id, repName: representative.name, ...values };
  }), [excelReport, monthlyRepresentatives, metrics, performanceData]);
  const draftKey = `${selectedShop?.id ?? ""}:${selectedMonth}:${excelReport ? getPerformanceDatasetId(excelReport) : "manual"}`;
  const activeDraft = achievementDraft?.key === draftKey ? achievementDraft : null;
  useEffect(() => {
    if (!achievementEditRequest || performanceQuery.isPending || achievementEditRequest.shopId !== selectedShop?.id || achievementEditRequest.month !== selectedMonth) return;
    setAchievementDraft({ key: draftKey, reps: initialAchievementReps });
    clearAchievementEditRequest();
    document.getElementById("edit-achievements-controls")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [achievementEditRequest, performanceQuery.isPending, selectedShop?.id, selectedMonth, draftKey, initialAchievementReps, clearAchievementEditRequest]);
  const importedReps = excelReport?.achievementOverride?.originalReps ?? excelReport?.reps;
  const originalRepActuals = useMemo(() => Object.fromEntries((importedReps ?? []).map(rep => [rep.repId, rep])) as Record<string, Partial<Record<PerformanceMetric, number>>>, [importedReps]);
  const editedRepActuals = useMemo(() => activeDraft ? Object.fromEntries(activeDraft.reps.map(rep => [rep.repId, rep])) as Record<string, Record<PerformanceMetric, number>> : undefined, [activeDraft]);
  const hasAchievementChanges = Boolean(activeDraft && activeDraft.reps.some(rep => {
    const saved = initialAchievementReps.find(item => item.repId === rep.repId);
    return saved && metrics.some(metric => (rep[metric] ?? 0) !== (saved[metric] ?? 0));
  }));
  const displayedShopActuals = useMemo(() => activeDraft && hasAchievementChanges ? metrics.reduce((totals, metric) => {
    totals[metric] = activeDraft.reps.reduce((sum, rep) => sum + (rep[metric] ?? 0), 0);
    return totals;
  }, {} as Record<PerformanceMetric, number>) : monthlyTotals, [activeDraft, hasAchievementChanges, metrics, monthlyTotals]);
  const originalShopActuals = excelReport?.achievementOverride?.originalShopActuals
    ?? (excelReport?.achievementOverride && importedReps
      ? metrics.reduce((totals, metric) => ({ ...totals, [metric]: importedReps.reduce((sum, rep) => sum + (rep[metric] ?? 0), 0) }), {} as Record<PerformanceMetric, number>)
      : excelReport ? getPerformanceShopActuals([excelReport], metrics) : undefined);
  const monthlyAchievement = monthlyTargets
    ? calculateTotalAchievement(displayedShopActuals, monthlyTargets, metricSettings)
    : 0;
  const revenue = excelReport?.revenue ?? monthData?.collection ?? selectedShop?.revenue;
  const qualityMetrics = excelReport?.qualityMetrics ?? monthData?.qualityMetrics;
  const isFinal = excelReport?.reportType === "completedMonth";
  const forecastDate = excelReport?.reportType === "midMonth" ? getForecastDate(excelReport, now) : now;
  const hasForecast = !isFinal && (excelReport?.reportType === "midMonth" || (isSameMonth(parseISO(`${selectedMonth}-01`), now) && performanceData.length >= 2));
  const forecastData = useMemo(() => {
    if (!hasForecast) return undefined;
    return projectMetrics(displayedShopActuals, metrics, forecastDate);
  }, [hasForecast, displayedShopActuals, metrics, forecastDate]);
  const totalPerformanceForecast = forecastData
    ? calculateTotalAchievement(forecastData, monthlyTargets, metricSettings)
    : null;

  const adjustAchievement = (repId: string, metric: PerformanceMetric, delta: -1 | 1) => {
    setAchievementDraft(current => current?.key === draftKey ? {
      ...current,
      reps: current.reps.map(rep => rep.repId === repId ? { ...rep, [metric]: Math.max(0, (rep[metric] ?? 0) + delta) } : rep),
    } : current);
  };

  const saveAchievements = async () => {
    if (!selectedShop || !monthlyTargets || !activeDraft || !hasAchievementChanges) return;
    setIsSavingAchievements(true);
    try {
      if (!selectedShop.monthlyData?.[selectedMonth]?.representatives) {
        const existingMonth = selectedShop.monthlyData?.[selectedMonth];
        await updateShop({
          ...selectedShop,
          monthlyData: {
            ...selectedShop.monthlyData,
            [selectedMonth]: {
              collection: existingMonth?.collection ?? selectedShop.revenue ?? 0,
              targets: existingMonth?.targets ?? monthlyTargets,
              representatives: monthlyRepresentatives,
              representativeTargets: existingMonth?.representativeTargets ?? Object.fromEntries(monthlyRepresentatives.map(rep => [rep.id, getEqualRepresentativeTargets(monthlyTargets, metrics, monthlyRepresentatives.length)])),
              metricSettings: existingMonth?.metricSettings ?? selectedShop.metricSettings,
              metricOrder: existingMonth?.metricOrder ?? selectedShop.metricOrder,
            },
          },
        });
      }
      const result = await handleSaveAchievementOverrides(selectedShop.id, selectedMonth, activeDraft.reps);
      if (!result.success) throw new Error(result.error);
      await refreshDataForShop(selectedShop.id, selectedMonth);
      setAchievementDraft(null);
      toast({ title: t("achievementsSaved") });
    } catch (error) {
      toast({ variant: "destructive", title: t("achievementSaveFailed"), description: error instanceof Error ? error.message : t("tryAgain") });
    } finally {
      setIsSavingAchievements(false);
    }
  };

  const revertAchievements = async () => {
    if (!selectedShop || !excelReport?.achievementOverride) return;
    setIsRevertingAchievements(true);
    try {
      const result = await handleRevertAchievementOverrides(selectedShop.id, getPerformanceDatasetId(excelReport));
      if (!result.success) throw new Error(result.error);
      await refreshDataForShop(selectedShop.id, selectedMonth);
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

  if (indexQuery.isPending || performanceQuery.isPending) {
    return <div className="shop-page-content flex min-h-64 items-center justify-center" role="status"><Loader2 className="h-5 w-5 animate-spin" />{t("loading")}</div>;
  }
  if (indexQuery.isError || performanceQuery.isError) {
    return <div className="shop-page-content text-destructive" role="alert">{t("tryAgain")}</div>;
  }
  if (!selectedShop || !monthlyTargets) {
    return <div className="flex h-full flex-col"><Header title={t("title")} /><div className="shop-page-content flex-1"><Link href={`/${locale}/`} className={cn(buttonVariants({ variant: "outline" }), "mb-4")}><ArrowLeft className="mr-2" />{t("backToOverview")}</Link><p>{t("shopNotFound")}</p></div></div>;
  }

  return (
    <div className="flex h-full flex-col">
      <Header title={`${t("title")}: ${selectedShop.name}`} />
      <div className="shop-page-content flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl space-y-2 sm:space-y-3">
          <ShopPageToolbar id="edit-achievements-controls" className="scroll-mt-4 rounded-md border bg-background px-3 py-2"
            periodSelector={<Select value={selectedReportValue} onValueChange={value => {
            const option = reportOptions.find(item => item.value === value);
            if (!option) return;
            setMonthSelection({ shopId: selectedShop.id, month: option.month });
            setSelectedDatasetId(option.month);
            setVersionSelection({ shopId: selectedShop.id, versionId: option.versionId });
          }}>
            <SelectTrigger className="h-9 w-full" aria-label={t("reportingPeriod")}><SelectValue /></SelectTrigger>
            <SelectContent>{reportOptions.map((option, index) => <SelectItem key={option.value} value={option.value}>
              <span className="sm:hidden">{option.report ? formatReportingDate(option.report.asOfDate ?? option.report.date, locale, "short") : formatReportingMonth(option.month, locale, "short")}</span>
              <span className="hidden sm:inline">{option.report ? formatReportingDate(option.report.asOfDate ?? option.report.date, locale) : formatReportingMonth(option.month, locale)}</span>
              {option.versionId !== "active" ? ` · ${option.report?.importName ?? `Older import ${index + 1}`}` : ""}
            </SelectItem>)}</SelectContent>
          </Select>}
          >
          {actor.role !== "viewer" && !selectedVersion && monthlyRepresentatives.length > 0 && (
            <>
              {activeDraft && <p className="mr-auto text-xs text-muted-foreground">{t("editAchievementsHint")}</p>}
              {activeDraft ? <div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={isSavingAchievements} onClick={() => setAchievementDraft(null)}>{t("cancel")}</Button><Button type="button" size="sm" disabled={isSavingAchievements || !hasAchievementChanges} onClick={() => void saveAchievements()}>{isSavingAchievements ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}{t("saveAchievements")}</Button></div> : <Button type="button" size="sm" variant="outline" onClick={() => setAchievementDraft({ key: draftKey, reps: initialAchievementReps })}><Pencil className="mr-1.5 h-4 w-4" />{t("editAchievements")}</Button>}
            </>
          )}
          </ShopPageToolbar>
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
                <Button type="button" variant="outline" size="sm" className="shrink-0 border-amber-400 bg-background/80" onClick={() => void revertAchievements()} disabled={isRevertingAchievements || Boolean(activeDraft)}>
                  {isRevertingAchievements ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                  {t("revertToImported")}
                </Button>
              )}
            </div>
          )}

          <div className="grid gap-2 sm:gap-3 xl:grid-cols-2">
          <Card className="w-full max-w-xl overflow-hidden">
            <CardHeader className="flex-row items-center justify-between space-y-0 px-3 py-2.5 sm:px-4 sm:py-3"><div><CardTitle className="text-sm sm:text-base">{t("totalPerformance")}</CardTitle><CardDescription className="hidden sm:block">{t("overallAchievement")}</CardDescription>{revenue !== undefined && <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground sm:mt-1 sm:gap-1.5 sm:text-xs"><Banknote className="h-3.5 w-3.5" />{t("revenueValue")}: {new Intl.NumberFormat(locale, { style: "currency", currency: "ALL", useGrouping: false, maximumFractionDigits: 0 }).format(revenue)}</p>}</div><div className="flex items-center gap-1.5 sm:gap-2"><Trophy className="h-5 w-5 text-primary sm:h-6 sm:w-6" /><div className="text-right"><p className="text-xl font-bold tracking-tight sm:text-2xl">{monthlyAchievement.toFixed(1)}%</p></div></div></CardHeader>
            <div className="mx-3 mb-2 flex items-center justify-between rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm sm:mx-4 sm:mb-3">
              <span className="flex items-center gap-2 font-medium text-muted-foreground"><TrendingUp className="h-4 w-4 text-primary" />{t("eomForecast")}</span>
              <span className="font-semibold tabular-nums">{isFinal ? "Final" : totalPerformanceForecast === null ? t("notAvailable") : `${totalPerformanceForecast.toFixed(1)}%`}</span>
            </div>
            <CardContent className="space-y-2 px-2 pb-2 sm:space-y-3 sm:px-3 sm:pb-3">
              <PerformanceTable
                actuals={displayedShopActuals}
                originalActuals={originalShopActuals}
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

          {monthlyRepresentatives.length ? <WorkerPerformanceList salesRepresentatives={monthlyRepresentatives} performanceData={performanceData} monthlyTargets={monthlyTargets} representativeTargets={representativeTargets} metricSettings={metricSettings} metricOrder={metrics} shopId={selectedShop.id} forecastDate={hasForecast ? forecastDate : undefined} forecastAsOf={hasForecast ? format(forecastDate, "PP") : undefined} isFinal={isFinal} editedActuals={editedRepActuals} originalActuals={excelReport ? originalRepActuals : undefined} onAdjustActual={activeDraft ? adjustAchievement : undefined} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
