
"use client";

import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  type PerformanceMetric,
  getShopMetrics,
  type Target,
  type SalesRepresentative,
  getMonthlyRepresentatives,
  getOverviewPerformanceData,
} from "@/lib/types";
import { Award, TrendingUp } from "lucide-react";
import { ScrollArea } from "./ui/scroll-area";
import { useTranslations } from "next-intl";
import { calculateTotalAchievement } from "@/lib/utils";
import { getEqualRepresentativeTargets } from "@/lib/representative-targets";
import { useShop } from "./shop-provider";
import { getDaysInMonth, parseISO } from "date-fns";

export function SalesRepresentativeRanking() {
  const t = useTranslations("Dashboard");
  const { shops, allPerformanceData, allMonthlyTargets, selectedDatasetId } = useShop();

  const rankedSalesReps = useMemo(() => {
    if (shops.length === 0) return [];
    
    const allReps: { name: string; shopName: string; achievement: number; forecastAchievement: number | null }[] = [];

    const availableEntries = Object.values(allPerformanceData).flatMap(getOverviewPerformanceData);
    const latestEntry = [...availableEntries].sort((a, b) => (b.importedAt ?? b.date).localeCompare(a.importedAt ?? a.date))[0];
    const activeDatasetId = availableEntries.some(entry => entry.date.startsWith(selectedDatasetId))
      ? selectedDatasetId
      : latestEntry?.date.slice(0, 7) ?? "";

    shops.forEach((shop) => {
      const shopPerformanceData = getOverviewPerformanceData(allPerformanceData[shop.id] || []);
      const performanceData = shopPerformanceData.filter(entry => entry.date.startsWith(activeDatasetId));
      const selectedEntry = performanceData[0];
      if (!selectedEntry) return;
      const latestMonth = selectedEntry.date.slice(0, 7);
      const savedRepresentatives = getMonthlyRepresentatives(shop, latestMonth);
      const representativesById = new Map(savedRepresentatives.map(rep => [rep.id, rep]));
      selectedEntry.reps.forEach(rep => representativesById.set(rep.repId, { id: rep.repId, name: rep.repName ?? representativesById.get(rep.repId)?.name ?? rep.repId }));
      const salesRepresentatives = [...representativesById.values()].filter(rep => selectedEntry.reps.some(entry => entry.repId === rep.id));
      if (salesRepresentatives.length === 0) return;

      const monthlyTargets = selectedEntry.targets ?? shop.monthlyData?.[latestMonth]?.targets ?? allMonthlyTargets[shop.id];

      if (!monthlyTargets || performanceData.length === 0) return;
      const monthData = shop.monthlyData?.[latestMonth];
      const metricSettings = monthData?.metricSettings ?? shop.metricSettings;
      const metrics = getShopMetrics({ ...shop, metricSettings, metricOrder: monthData?.metricOrder ?? shop.metricOrder }, monthlyTargets);
      const forecastDate = parseISO(selectedEntry.asOfDate ?? selectedEntry.date);
      const daysInMonth = getDaysInMonth(forecastDate);
      const dayOfMonth = Math.max(forecastDate.getDate(), 1);

      // Simplified calculation - only process if we have data
      const repTotals: Record<string, Record<PerformanceMetric, number>> = {};
      salesRepresentatives.forEach(rep => {
        repTotals[rep.id] = metrics.reduce((acc, metric) => {
          acc[metric] = 0;
          return acc;
        }, {} as Record<PerformanceMetric, number>);
      });

      // Process performance data more efficiently
      performanceData.forEach(day => {
        day.reps.forEach(repData => {
          if (repTotals[repData.repId]) {
            metrics.forEach(metric => {
              repTotals[repData.repId][metric] += repData[metric] || 0;
            });
          }
        });
      });

      const repTargets = getEqualRepresentativeTargets(monthlyTargets, metrics, salesRepresentatives.length);

      salesRepresentatives.forEach((rep) => {
        const currentTotals = repTotals[rep.id];
        const achievement = calculateTotalAchievement(currentTotals, repTargets, metricSettings);
        
        // Simplified forecast calculation
        const forecastAchievement = selectedEntry.reportType === "completedMonth"
          ? null
          : (achievement / dayOfMonth) * daysInMonth;

        allReps.push({
          name: rep.name,
          shopName: shop.name,
          achievement,
          forecastAchievement,
        });
      });
    });

    return allReps.sort((a, b) => b.achievement - a.achievement);
  }, [shops, allPerformanceData, allMonthlyTargets, selectedDatasetId]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-medium text-center">{t('topSalesReps')}</h2>
      <div className="space-y-3">
        {rankedSalesReps.slice(0, 5).map((rep, index) => (
          <div key={index} className="flex items-center justify-between p-3 rounded-lg border border-border">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                {index + 1}
              </div>
              <div>
                <p className="font-medium">{rep.name}</p>
                <p className="text-xs text-muted-foreground">{rep.shopName}</p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-semibold">{rep.achievement.toFixed(1)}%</div>
              <div className="text-xs text-muted-foreground">
                EOM: {rep.forecastAchievement === null ? "Final" : `${rep.forecastAchievement.toFixed(1)}%`}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
