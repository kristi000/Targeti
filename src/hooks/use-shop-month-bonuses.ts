import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchBonusSnapshot } from "@/server/actions/bonus";
import { getMonthlyBonusForecast } from "@/lib/forecast";
import { calculateManagerBonus } from "@/lib/manager-bonus";
import { calculateRepresentativeBonus } from "@/lib/sales-representative-bonus";
import { getEqualRepresentativeTargets, roundRepresentativeTargets } from "@/lib/representative-targets";
import { getActivePerformanceData, getMonthlyRepresentatives, getPerformanceShopActuals, getShopMetrics, type PerformanceData, type PerformanceMetric, type Shop, type Target } from "@/lib/types";
import { bonusSnapshotQueryKey } from "@/lib/query-keys";
import { shopPerformanceMonthQueryOptions } from "@/lib/performance-queries";

const EMPTY_PERFORMANCE: PerformanceData[] = [];

/**
 * Live manager and sales-representative bonuses for one shop and month, the finalized payroll
 * snapshot when there is one, and the month-end forecast. Shared by the bonus page and the
 * manager mobile app.
 */
export function useShopMonthBonuses(shop: Shop | null, month: string, legacyTargets: Target | undefined) {
  const performanceQuery = useQuery({
    ...shopPerformanceMonthQueryOptions(shop?.id ?? "", month),
    enabled: Boolean(shop && month),
  });
  const allData = performanceQuery.data ?? EMPTY_PERFORMANCE;
  const snapshotQuery = useQuery({
    queryKey: bonusSnapshotQueryKey(shop?.id ?? "", month),
    queryFn: () => fetchBonusSnapshot(shop!.id, month),
    enabled: Boolean(shop && month),
    staleTime: 60_000,
  });

  const monthData = shop?.monthlyData?.[month];
  const performanceData = useMemo(() => getActivePerformanceData(allData).filter(entry => entry.date.startsWith(month)), [allData, month]);
  const latestImport = performanceData.find(entry => entry.importId);
  const targets = latestImport?.targets ?? monthData?.targets ?? legacyTargets;
  const metricSettings = latestImport?.metricSettings ?? monthData?.metricSettings ?? shop?.metricSettings;
  const metricOrder = latestImport?.metricOrder ?? monthData?.metricOrder ?? shop?.metricOrder;
  const metrics = useMemo(() => getShopMetrics(shop ? { ...shop, metricOrder, metricSettings } : undefined, targets), [shop, metricOrder, metricSettings, targets]);
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
  const representatives = useMemo(() => !shop ? [] : latestImport
    ? latestImport.reps.map(rep => ({ id: rep.repId, name: rep.repName ?? rep.repId }))
    : getMonthlyRepresentatives(shop, month), [shop, latestImport, month]);
  const collection = latestImport?.revenue ?? monthData?.collection ?? shop?.revenue;
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

  const forecast = useMemo(() => shop && month
    ? getMonthlyBonusForecast(shop, month, allData, legacyTargets)
    : null, [shop, month, allData, legacyTargets]);

  const snapshot = snapshotQuery.data ?? null;
  const managerResult = snapshot?.manager ?? liveBonuses?.manager;
  const representativeResults = snapshot?.representatives ?? liveBonuses?.representatives.map(item => ({ ...item, eligible: item.result.shopBonusEligible })) ?? [];
  const displayRepresentatives = snapshot?.representatives.map(item => ({ id: item.id, name: item.name })) ?? representatives;

  return {
    performanceQuery,
    snapshotQuery,
    snapshot,
    targets,
    metrics,
    metricSettings,
    collection,
    shopActuals: totals.shop,
    managerResult,
    representativeResults,
    displayRepresentatives,
    forecast,
  };
}
