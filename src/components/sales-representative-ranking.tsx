"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, ChevronUp, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { calculateTotalAchievement, cn } from "@/lib/utils";
import { calculateForecastAchievement, getForecastDate } from "@/lib/forecast";
import { getEqualRepresentativeTargets } from "@/lib/representative-targets";
import {
  getMonthlyRepresentatives,
  getOverviewPerformanceData,
  getShopMetrics,
  type PerformanceMetric,
} from "@/lib/types";
import { useShop } from "./shop-provider";

export function SalesRepresentativeRanking() {
  const t = useTranslations("Dashboard");
  const locale = useLocale();
  const { shops, allPerformanceData, allMonthlyTargets, selectedDatasetId } = useShop();
  const [query, setQuery] = useState("");
  const [shopId, setShopId] = useState("all");
  const [expanded, setExpanded] = useState(false);

  const rankedSalesReps = useMemo(() => {
    if (shops.length === 0) return [];
    const allReps: { id: string; name: string; shopId: string; shopName: string; achievement: number; forecastAchievement: number | null }[] = [];
    const availableEntries = Object.values(allPerformanceData).flatMap(getOverviewPerformanceData);
    const latestEntry = [...availableEntries].sort((left, right) => (right.importedAt ?? right.date).localeCompare(left.importedAt ?? left.date))[0];
    const activeDatasetId = availableEntries.some(entry => entry.date.startsWith(selectedDatasetId))
      ? selectedDatasetId
      : latestEntry?.date.slice(0, 7) ?? "";

    shops.forEach(shop => {
      const performanceData = getOverviewPerformanceData(allPerformanceData[shop.id] || []).filter(entry => entry.date.startsWith(activeDatasetId));
      const selectedEntry = performanceData[0];
      if (!selectedEntry) return;
      const latestMonth = selectedEntry.date.slice(0, 7);
      const representatives = getMonthlyRepresentatives(shop, latestMonth);
      const monthlyTargets = selectedEntry.targets ?? shop.monthlyData?.[latestMonth]?.targets ?? allMonthlyTargets[shop.id];
      if (!monthlyTargets || representatives.length === 0) return;

      const monthData = shop.monthlyData?.[latestMonth];
      const metricSettings = monthData?.metricSettings ?? shop.metricSettings;
      const metrics = getShopMetrics({ ...shop, metricSettings, metricOrder: monthData?.metricOrder ?? shop.metricOrder }, monthlyTargets);
      const equalRepresentativeTargets = getEqualRepresentativeTargets(monthlyTargets, metrics, representatives.length);
      const forecastDate = getForecastDate(selectedEntry);
      const totalsByRepresentative = new Map<string, Record<PerformanceMetric, number>>();
      performanceData.forEach(entry => entry.reps.forEach(rep => {
        const totals = totalsByRepresentative.get(rep.repId)
          ?? Object.fromEntries(metrics.map(metric => [metric, 0])) as Record<PerformanceMetric, number>;
        metrics.forEach(metric => { totals[metric] += rep[metric] ?? 0; });
        totalsByRepresentative.set(rep.repId, totals);
      }));

      representatives.forEach(representative => {
        const totals = totalsByRepresentative.get(representative.id)
          ?? Object.fromEntries(metrics.map(metric => [metric, 0])) as Record<PerformanceMetric, number>;
        const representativeTargets = monthData?.representativeTargets?.[representative.id] ?? equalRepresentativeTargets;
        const achievement = calculateTotalAchievement(totals, representativeTargets, metricSettings);
        allReps.push({
          id: representative.id,
          name: representative.name,
          shopId: shop.id,
          shopName: shop.name,
          achievement,
          forecastAchievement: selectedEntry.reportType === "completedMonth"
            ? null
            : calculateForecastAchievement(totals, representativeTargets, metrics, forecastDate, metricSettings),
        });
      });
    });

    return allReps
      .sort((left, right) => right.achievement - left.achievement)
      .map((representative, index) => ({ ...representative, rank: index + 1 }));
  }, [shops, allPerformanceData, allMonthlyTargets, selectedDatasetId]);

  const filteredRepresentatives = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    return rankedSalesReps.filter(rep =>
      (shopId === "all" || rep.shopId === shopId)
      && (!normalizedQuery || `${rep.name} ${rep.shopName}`.toLocaleLowerCase(locale).includes(normalizedQuery))
    );
  }, [rankedSalesReps, query, shopId, locale]);
  const visibleRepresentatives = expanded ? filteredRepresentatives : filteredRepresentatives.slice(0, 5);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b border-slate-300 bg-slate-50 px-4 py-3">
        <div><h2 className="font-semibold text-slate-900">{t("topSalesReps")}</h2><p className="text-xs text-slate-500">Network leaderboard by shop</p></div>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search representatives…" aria-label="Search representatives" className="h-9 bg-white pl-9" /></div>
          <select value={shopId} onChange={event => { setShopId(event.target.value); setExpanded(false); }} aria-label="Filter representatives by shop" className="h-9 min-w-0 max-w-32 rounded-md border bg-white px-2 text-sm">
            <option value="all">All shops</option>
            {[...shops].sort((left, right) => left.name.localeCompare(right.name, locale)).map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 divide-y overflow-y-auto">
        {visibleRepresentatives.map(rep => {
          return <Link key={`${rep.shopId}-${rep.id}`} href={`/${locale}/shop/${rep.shopId}#representative-bonuses`} className="flex items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-muted/50">
            <div className="flex min-w-0 items-center gap-3"><span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold", rep.rank <= 3 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{rep.rank}</span><div className="min-w-0"><p className="truncate font-medium">{rep.name}</p><p className="truncate text-xs text-muted-foreground">{rep.shopName}</p></div></div>
            <div className="shrink-0 text-right"><p className="font-semibold tabular-nums">{rep.achievement.toFixed(1)}%</p><p className="text-xs text-muted-foreground">EOM: {rep.forecastAchievement === null ? "Final" : `${rep.forecastAchievement.toFixed(1)}%`}</p></div>
          </Link>;
        })}
        {!visibleRepresentatives.length && <div className="p-8 text-center text-sm text-muted-foreground">No representatives match these filters.</div>}
      </div>

      {filteredRepresentatives.length > 5 && <div className="flex items-center justify-between gap-3 border-t bg-slate-50 px-4 py-3"><p className="text-sm text-muted-foreground">Showing {visibleRepresentatives.length} of {filteredRepresentatives.length}</p><Button type="button" variant="outline" size="sm" onClick={() => setExpanded(current => !current)}>{expanded ? <ChevronUp className="mr-2 h-4 w-4" /> : <ChevronDown className="mr-2 h-4 w-4" />}{expanded ? "Show top 5" : "View all"}</Button></div>}
    </div>
  );
}
