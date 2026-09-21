"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, CalendarCheck, CheckCircle2, Loader2, Users } from "lucide-react";
import { format, isSameMonth, parseISO } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { fetchBonusSnapshot, saveBonusSnapshot } from "@/app/actions/bonus";
import { Header } from "@/components/header";
import { ManagerBonusCard } from "@/components/manager-bonus-card";
import { RepresentativeBonusCards } from "@/components/representative-bonus-cards";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useShop } from "@/components/shop-provider";
import { useToast } from "@/hooks/use-toast";
import { getForecastDate, projectMetrics } from "@/lib/forecast";
import { calculateManagerBonus, MANAGER_PAYOUT_TABLE_VERSION } from "@/lib/manager-bonus";
import { calculateRepresentativeBonus, REPRESENTATIVE_PAYOUT_TABLE_VERSION } from "@/lib/sales-representative-bonus";
import { getEqualRepresentativeTargets, roundRepresentativeTargets } from "@/lib/representative-targets";
import { getActivePerformanceData, getMonthlyRepresentatives, getPerformanceMonthsByImportRecency, getPerformanceShopActuals, getShopMetrics, type BonusSnapshot, type PerformanceData, type PerformanceIndexEntry, type PerformanceMetric } from "@/lib/types";
import { formatReportingMonth } from "@/lib/reporting-month";
import { bonusSnapshotQueryKey } from "@/lib/query-keys";
import { shopPerformanceIndexQueryOptions, shopPerformanceMonthQueryOptions } from "@/lib/performance-queries";

const EMPTY_INDEX: PerformanceIndexEntry[] = [];
const EMPTY_PERFORMANCE: PerformanceData[] = [];

export function BonusDashboardClient({ requestedMonth }: { requestedMonth?: string }) {
  const { selectedShop, allMonthlyTargets, selectedDatasetId, setSelectedDatasetId, setSelectedPerformanceId } = useShop();
  const t = useTranslations("DetailedDashboard");
  const locale = useLocale();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const indexQuery = useQuery({ ...shopPerformanceIndexQueryOptions(selectedShop?.id ?? ""), enabled: Boolean(selectedShop) });
  const index = indexQuery.data ?? EMPTY_INDEX;
  const months = useMemo(
    () => getPerformanceMonthsByImportRecency(index, Object.keys(selectedShop?.monthlyData ?? {})),
    [index, selectedShop?.monthlyData],
  );
  const [monthSelection, setMonthSelection] = useState({ shopId: "", month: "" });
  const [finalizing, setFinalizing] = useState(false);
  const selectedMonth = monthSelection.shopId === selectedShop?.id && months.includes(monthSelection.month)
    ? monthSelection.month
    : requestedMonth && months.includes(requestedMonth) ? requestedMonth
    : months.includes(selectedDatasetId) ? selectedDatasetId : months[0] ?? "";
  const performanceQuery = useQuery({
    ...shopPerformanceMonthQueryOptions(selectedShop?.id ?? "", selectedMonth),
    enabled: Boolean(selectedShop && selectedMonth && !indexQuery.isPending),
  });
  const allData = performanceQuery.data ?? EMPTY_PERFORMANCE;
  useEffect(() => {
    if (selectedMonth) setSelectedDatasetId(selectedMonth);
    setSelectedPerformanceId(null);
  }, [selectedMonth, setSelectedDatasetId, setSelectedPerformanceId]);
  const snapshotQuery = useQuery({
    queryKey: bonusSnapshotQueryKey(selectedShop?.id ?? "", selectedMonth),
    queryFn: () => fetchBonusSnapshot(selectedShop!.id, selectedMonth),
    enabled: Boolean(selectedShop && selectedMonth),
    staleTime: 60_000,
  });

  const legacyTargets = selectedShop ? allMonthlyTargets[selectedShop.id] : undefined;
  const monthData = selectedShop?.monthlyData?.[selectedMonth];
  const performanceData = useMemo(() => getActivePerformanceData(allData).filter(entry => entry.date.startsWith(selectedMonth)), [allData, selectedMonth]);
  const latestImport = performanceData.find(entry => entry.importId);
  const targets = latestImport?.targets ?? monthData?.targets ?? legacyTargets;
  const metricSettings = latestImport?.metricSettings ?? monthData?.metricSettings ?? selectedShop?.metricSettings;
  const metricOrder = latestImport?.metricOrder ?? monthData?.metricOrder ?? selectedShop?.metricOrder;
  const metrics = useMemo(() => getShopMetrics(selectedShop ? { ...selectedShop, metricOrder, metricSettings } : undefined, targets), [selectedShop, metricOrder, metricSettings, targets]);
  const totals = useMemo(() => {
    const reps = performanceData.reduce((result, day) => {
      day.reps.forEach(rep => metrics.forEach(metric => {
        result[rep.repId] ??= {} as Record<PerformanceMetric, number>;
        result[rep.repId][metric] = (result[rep.repId][metric] ?? 0) + (rep[metric] ?? 0);
      }));
      return result;
    }, {} as Record<string, Record<PerformanceMetric, number>>);
    return { shop: getPerformanceShopActuals(performanceData, metrics), reps };
  }, [performanceData, metrics]);
  const representatives = useMemo(() => !selectedShop ? [] : latestImport
    ? latestImport.reps.map(rep => ({ id: rep.repId, name: rep.repName ?? rep.repId }))
    : getMonthlyRepresentatives(selectedShop, selectedMonth), [selectedShop, latestImport, selectedMonth]);
  const collection = latestImport?.revenue ?? monthData?.collection ?? selectedShop?.revenue;
  const forecastCollection = latestImport?.revenue ?? monthData?.collection;
  const savedRepresentativeTargets = latestImport?.representativeTargets ?? monthData?.representativeTargets;
  const individualTargets = useMemo(() => {
    if (savedRepresentativeTargets) {
      return Object.fromEntries(Object.entries(savedRepresentativeTargets).map(([repId, repTargets]) => [repId, roundRepresentativeTargets(repTargets)]));
    }
    if (!targets) return {};
    return Object.fromEntries(representatives.map(rep => [rep.id, getEqualRepresentativeTargets(targets, metrics, representatives.length)]));
  }, [savedRepresentativeTargets, representatives, targets, metrics]);
  const representativeActuals = useMemo(() => Object.fromEntries(representatives.map(rep => [
    rep.id,
    totals.reps[rep.id] ?? Object.fromEntries(metrics.map(metric => [metric, 0])) as Record<PerformanceMetric, number>,
  ])) as Record<string, Record<PerformanceMetric, number>>, [representatives, totals.reps, metrics]);
  const liveBonuses = useMemo(() => {
    if (collection === undefined || !targets) return null;
    return {
      manager: calculateManagerBonus(collection, totals.shop, targets, metrics, metricSettings),
      representatives: representatives.map(rep => ({
        id: rep.id,
        name: rep.name,
        result: calculateRepresentativeBonus(collection, representativeActuals[rep.id], individualTargets[rep.id], totals.shop, targets, metrics, metricSettings),
      })),
    };
  }, [collection, targets, totals.shop, metrics, metricSettings, representatives, representativeActuals, individualTargets]);

  const now = new Date();
  const isFinalReport = latestImport?.reportType === "completedMonth";
  const hasForecast = !isFinalReport && (latestImport?.reportType === "midMonth"
    || (selectedMonth && isSameMonth(parseISO(`${selectedMonth}-01`), now) && performanceData.length >= 2));
  const forecastDate = latestImport?.reportType === "midMonth" ? getForecastDate(latestImport, now) : now;
  const forecastDay = hasForecast ? format(forecastDate, "yyyy-MM-dd") : null;
  const forecast = useMemo(() => {
    if (!forecastDay || forecastCollection === undefined || !targets) return null;
    const asOfDate = parseISO(forecastDay);
    const daysInMonth = new Date(asOfDate.getFullYear(), asOfDate.getMonth() + 1, 0).getDate();
    const projectedCollection = forecastCollection / Math.max(asOfDate.getDate(), 1) * daysInMonth;
    const shop = projectMetrics(totals.shop, metrics, asOfDate);
    return {
      manager: calculateManagerBonus(projectedCollection, shop, targets, metrics, metricSettings),
      representatives: Object.fromEntries(representatives.map(rep => [
        rep.id,
        calculateRepresentativeBonus(projectedCollection, projectMetrics(representativeActuals[rep.id], metrics, asOfDate), individualTargets[rep.id], shop, targets, metrics, metricSettings),
      ])),
    };
  }, [forecastDay, forecastCollection, targets, totals.shop, metrics, metricSettings, representatives, representativeActuals, individualTargets]);

  if (indexQuery.isPending || performanceQuery.isPending) return <div className="flex min-h-64 items-center justify-center gap-2 p-6" role="status"><Loader2 className="h-5 w-5 animate-spin" />{t("loading")}</div>;
  if (indexQuery.isError || performanceQuery.isError) return <div className="p-6 text-destructive" role="alert">{t("tryAgain")}</div>;
  if (!selectedShop || !targets) return null;
  const snapshot = snapshotQuery.data ?? null;
  const managerResult = snapshot?.manager ?? liveBonuses?.manager;
  const representativeResults = snapshot?.representatives ?? liveBonuses?.representatives.map(item => ({ ...item, eligible: item.result.shopBonusEligible })) ?? [];
  const displayRepresentatives = snapshot?.representatives.map(item => ({ id: item.id, name: item.name })) ?? representatives;
  const forecastAsOf = snapshot || snapshotQuery.isPending || !forecastDay ? undefined : format(parseISO(forecastDay), "PP");

  const finalize = async () => {
    if (collection === undefined || !liveBonuses || snapshot || snapshotQuery.isPending || snapshotQuery.isError) return;
    setFinalizing(true);
    const nextSnapshot: BonusSnapshot = { month: selectedMonth, finalizedAt: new Date().toISOString(), calculationVersion: "bonus-calculation-2026-01", payoutTableVersion: `${MANAGER_PAYOUT_TABLE_VERSION};${REPRESENTATIVE_PAYOUT_TABLE_VERSION}`, inputs: { collection, targets, representativeTargets: individualTargets, metricSettings, metricOrder: [...metrics], shopActuals: totals.shop, representativeActuals }, manager: liveBonuses.manager, representatives: liveBonuses.representatives.map(item => ({ ...item, eligible: item.result.shopBonusEligible })) };
    try {
      const result = await saveBonusSnapshot(selectedShop.id, nextSnapshot);
      if (!result.success) throw new Error(result.error);
      queryClient.setQueryData(bonusSnapshotQueryKey(selectedShop.id, selectedMonth), nextSnapshot);
      toast({ title: "Month finalized", description: `${formatReportingMonth(selectedMonth, locale)} is now locked for payroll.` });
    } catch (error) { toast({ variant: "destructive", title: "Finalization failed", description: error instanceof Error ? error.message : "Could not save the payroll snapshot." }); }
    finally { setFinalizing(false); }
  };

  return <div className="flex h-full flex-col"><Header title={`${t("bonusPage")}: ${selectedShop.name}`} actions={<select aria-label="Import month" className="h-9 w-32 shrink-0 rounded-md border bg-background px-3 text-sm text-foreground sm:w-40" value={selectedMonth} onChange={event => setMonthSelection({ shopId: selectedShop.id, month: event.target.value })}>{months.map(month => <option key={month} value={month}>{format(parseISO(`${month}-01`), "MMMM yyyy")}</option>)}</select>} /><div className="flex-1 overflow-y-auto p-3 md:p-4"><div className="mx-auto w-full max-w-6xl space-y-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-2xl font-semibold">{t("monthlyBonuses")}</h2><p className="text-sm text-muted-foreground">{selectedMonth ? t("bonusMonthDescription", { month: format(parseISO(`${selectedMonth}-01`), "MMMM yyyy") }) : t("noData")}</p></div><Button onClick={finalize} disabled={!liveBonuses || !!snapshot || snapshotQuery.isPending || snapshotQuery.isError || finalizing}><CalendarCheck className="mr-2 h-4 w-4" />{snapshot ? "Finalized" : finalizing ? "Finalizing…" : "Finalize month"}</Button></div>{snapshot && <p className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />Payroll snapshot finalized {new Date(snapshot.finalizedAt).toLocaleString(locale)}. Displaying locked values.</p>}{collection !== undefined && managerResult ? <Tabs defaultValue="manager"><TabsList className="grid w-full grid-cols-2 sm:w-[420px]"><TabsTrigger value="manager"><BriefcaseBusiness className="mr-2 h-4 w-4" />{t("managerBonusButton")}</TabsTrigger><TabsTrigger value="representatives"><Users className="mr-2 h-4 w-4" />{t("representativeBonusButton")}</TabsTrigger></TabsList><TabsContent value="manager" className="mt-4"><ManagerBonusCard result={managerResult} forecast={forecastAsOf ? forecast?.manager : undefined} forecastAsOf={forecastAsOf} metricSettings={metricSettings} /></TabsContent><TabsContent value="representatives" className="mt-4"><RepresentativeBonusCards representatives={displayRepresentatives} results={Object.fromEntries(representativeResults.map(item => [item.id, item.result]))} forecasts={forecastAsOf ? forecast?.representatives : undefined} forecastAsOf={forecastAsOf} metricSettings={metricSettings} /></TabsContent></Tabs> : <p className="rounded-lg border p-6 text-sm text-muted-foreground">{t("managerBonusMissingCollection")}</p>}</div></div></div>;
}
