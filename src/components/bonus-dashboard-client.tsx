"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BriefcaseBusiness, CheckCircle2, Loader2, Users } from "lucide-react";
import { format } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { fetchBonusSnapshot } from "@/app/actions/bonus";
import { ManagerBonusCard } from "@/components/manager-bonus-card";
import { RepresentativeBonusCards } from "@/components/representative-bonus-cards";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useShop } from "@/components/shop-provider";
import { getMonthlyBonusForecast } from "@/lib/forecast";
import { calculateManagerBonus } from "@/lib/manager-bonus";
import { calculateRepresentativeBonus } from "@/lib/sales-representative-bonus";
import { getEqualRepresentativeTargets, roundRepresentativeTargets } from "@/lib/representative-targets";
import { getActivePerformanceData, getMonthlyRepresentatives, getPerformanceShopActuals, getShopMetrics, type PerformanceData, type PerformanceMetric } from "@/lib/types";
import { bonusSnapshotQueryKey } from "@/lib/query-keys";
import { shopPerformanceMonthQueryOptions } from "@/lib/performance-queries";

const EMPTY_PERFORMANCE: PerformanceData[] = [];

export function BonusDashboardClient({ selectedMonth }: { selectedMonth: string }) {
  const { selectedShop, allMonthlyTargets, setSelectedDatasetId, setSelectedPerformanceId } = useShop();
  const t = useTranslations("DetailedDashboard");
  const locale = useLocale();
  const performanceQuery = useQuery({
    ...shopPerformanceMonthQueryOptions(selectedShop?.id ?? "", selectedMonth),
    enabled: Boolean(selectedShop && selectedMonth),
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

  const forecast = useMemo(() => selectedShop && selectedMonth
    ? getMonthlyBonusForecast(selectedShop, selectedMonth, allData, legacyTargets)
    : null, [selectedShop, selectedMonth, allData, legacyTargets]);

  if (!selectedShop) return null;
  const snapshot = snapshotQuery.data ?? null;
  const managerResult = snapshot?.manager ?? liveBonuses?.manager;
  const representativeResults = snapshot?.representatives ?? liveBonuses?.representatives.map(item => ({ ...item, eligible: item.result.shopBonusEligible })) ?? [];
  const displayRepresentatives = snapshot?.representatives.map(item => ({ id: item.id, name: item.name })) ?? representatives;
  const forecastAsOf = snapshot || snapshotQuery.isPending || !forecast ? undefined : format(forecast.asOfDate, "PP");

  if (performanceQuery.isError) return <div className="p-6 text-destructive" role="alert">{t("tryAgain")}</div>;
  if (selectedMonth && performanceQuery.isPending) return <div className="flex min-h-64 items-center justify-center gap-2 p-6" role="status"><Loader2 className="h-5 w-5 animate-spin" />{t("loading")}</div>;
  if (!selectedMonth || !targets) return <p className="text-sm text-muted-foreground">{t("noData")}</p>;
  return <>
    {snapshot && <p className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />Payroll snapshot finalized {new Date(snapshot.finalizedAt).toLocaleString(locale)}. Displaying locked values.</p>}
    {collection !== undefined && managerResult ? <Tabs defaultValue="manager">
      <TabsList className="grid w-full grid-cols-2 sm:w-[420px]"><TabsTrigger value="manager"><BriefcaseBusiness className="mr-2 h-4 w-4" />{t("managerBonusButton")}</TabsTrigger><TabsTrigger value="representatives"><Users className="mr-2 h-4 w-4" />{t("representativeBonusButton")}</TabsTrigger></TabsList>
      <TabsContent value="manager" className="mt-4"><ManagerBonusCard result={managerResult} forecast={forecastAsOf ? forecast?.manager : undefined} forecastAsOf={forecastAsOf} metricSettings={metricSettings} /></TabsContent>
      <TabsContent value="representatives" className="mt-4"><RepresentativeBonusCards representatives={displayRepresentatives} results={Object.fromEntries(representativeResults.map(item => [item.id, item.result]))} forecasts={forecastAsOf ? Object.fromEntries(forecast!.representatives.map(item => [item.id, item.result])) : undefined} forecastAsOf={forecastAsOf} metricSettings={metricSettings} /></TabsContent>
    </Tabs> : <p className="rounded-lg border p-6 text-sm text-muted-foreground">{t("managerBonusMissingCollection")}</p>}
  </>;
}
