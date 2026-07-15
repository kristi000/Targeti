"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { getDaysInMonth } from "date-fns";
import { ArrowRight, ChevronDown, ChevronUp, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { calculateTotalAchievement, cn } from "@/lib/utils";
import { getForecastDate } from "@/lib/forecast";
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
      const representativesById = new Map(getMonthlyRepresentatives(shop, latestMonth).map(rep => [rep.id, rep]));
      selectedEntry.reps.forEach(rep => representativesById.set(rep.repId, { id: rep.repId, name: rep.repName ?? representativesById.get(rep.repId)?.name ?? rep.repId }));
      const representatives = [...representativesById.values()].filter(rep => selectedEntry.reps.some(entry => entry.repId === rep.id));
      const monthlyTargets = selectedEntry.targets ?? shop.monthlyData?.[latestMonth]?.targets ?? allMonthlyTargets[shop.id];
      if (!monthlyTargets || representatives.length === 0) return;

      const monthData = shop.monthlyData?.[latestMonth];
      const metricSettings = monthData?.metricSettings ?? shop.metricSettings;
      const metrics = getShopMetrics({ ...shop, metricSettings, metricOrder: monthData?.metricOrder ?? shop.metricOrder }, monthlyTargets);
      const repTargets = getEqualRepresentativeTargets(monthlyTargets, metrics, representatives.length);
      const forecastDate = getForecastDate(selectedEntry);
      const dayOfMonth = Math.max(forecastDate.getDate(), 1);

      representatives.forEach(representative => {
        const totals = metrics.reduce((result, metric) => {
          result[metric] = performanceData.reduce((sum, entry) => sum + (entry.reps.find(rep => rep.repId === representative.id)?.[metric] ?? 0), 0);
          return result;
        }, {} as Record<PerformanceMetric, number>);
        const achievement = calculateTotalAchievement(totals, repTargets, metricSettings);
        allReps.push({
          id: representative.id,
          name: representative.name,
          shopId: shop.id,
          shopName: shop.name,
          achievement,
          forecastAchievement: selectedEntry.reportType === "completedMonth" ? null : (achievement / dayOfMonth) * getDaysInMonth(forecastDate),
        });
      });
    });

    return allReps.sort((left, right) => right.achievement - left.achievement);
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
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div><h2 className="text-xl font-semibold">{t("topSalesReps")}</h2><p className="mt-1 text-sm text-muted-foreground">Search the network leaderboard or focus on one shop.</p></div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative sm:w-64"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search representatives…" aria-label="Search representatives" className="pl-9" /></div>
          <select value={shopId} onChange={event => { setShopId(event.target.value); setExpanded(false); }} aria-label="Filter representatives by shop" className="h-10 rounded-md border bg-background px-3 text-sm">
            <option value="all">All shops</option>
            {[...shops].sort((left, right) => left.name.localeCompare(right.name, locale)).map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
          </select>
        </div>
      </div>

      <div className="divide-y overflow-hidden rounded-lg border">
        {visibleRepresentatives.map((rep, index) => {
          const networkRank = rankedSalesReps.findIndex(item => item.id === rep.id && item.shopId === rep.shopId) + 1;
          return <Link key={`${rep.shopId}-${rep.id}`} href={`/${locale}/shop/${rep.shopId}#representative-bonuses`} className="group flex items-center justify-between gap-3 p-3 transition-colors hover:bg-muted/50">
            <div className="flex min-w-0 items-center gap-3"><span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold", networkRank <= 3 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{networkRank}</span><div className="min-w-0"><p className="truncate font-medium">{rep.name}</p><p className="truncate text-xs text-muted-foreground">{rep.shopName}</p></div></div>
            <div className="flex shrink-0 items-center gap-3 text-right"><div><p className="font-semibold tabular-nums">{rep.achievement.toFixed(1)}%</p><p className="text-xs text-muted-foreground">EOM: {rep.forecastAchievement === null ? "Final" : `${rep.forecastAchievement.toFixed(1)}%`}</p></div><ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></div>
          </Link>;
        })}
        {!visibleRepresentatives.length && <div className="p-8 text-center text-sm text-muted-foreground">No representatives match these filters.</div>}
      </div>

      {filteredRepresentatives.length > 5 && <div className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Showing {visibleRepresentatives.length} of {filteredRepresentatives.length}</p><Button type="button" variant="outline" size="sm" onClick={() => setExpanded(current => !current)}>{expanded ? <ChevronUp className="mr-2 h-4 w-4" /> : <ChevronDown className="mr-2 h-4 w-4" />}{expanded ? "Show top 5" : "View all"}</Button></div>}
    </div>
  );
}
