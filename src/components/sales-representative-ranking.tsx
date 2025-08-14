
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
  performanceMetrics,
  type Target,
  type SalesRepresentative,
} from "@/lib/types";
import { Award, TrendingUp } from "lucide-react";
import { ScrollArea } from "./ui/scroll-area";
import { useTranslations } from "next-intl";
import { calculateTotalAchievement } from "@/lib/utils";
import { useShop } from "./shop-provider";
import { getDaysInMonth } from "date-fns";

export function SalesRepresentativeRanking() {
  const t = useTranslations("Dashboard");
  const { shops, allPerformanceData, allMonthlyTargets } = useShop();

  const rankedSalesReps = useMemo(() => {
    const allReps: { name: string; shopName: string; achievement: number, forecastAchievement: number }[] = [];
    const today = new Date();
    const daysInMonth = getDaysInMonth(today);
    const dayOfMonth = today.getDate();

    shops.forEach((shop) => {
      const { salesRepresentatives = [] } = shop;
      if (salesRepresentatives.length === 0) return;

      const performanceData = allPerformanceData[shop.id] || [];
      const monthlyTargets = allMonthlyTargets[shop.id];

      if (!monthlyTargets) return;

      const repTotals: Record<string, Record<PerformanceMetric, number>> = {};
      salesRepresentatives.forEach(rep => {
          repTotals[rep.id] = performanceMetrics.reduce((acc, metric) => {
              acc[metric] = 0;
              return acc;
          }, {} as Record<PerformanceMetric, number>);
      });

      performanceData.forEach(day => {
          day.reps.forEach(repData => {
              if (repTotals[repData.repId]) {
                  performanceMetrics.forEach(metric => {
                      repTotals[repData.repId][metric] += repData[metric];
                  });
              }
          });
      });

      const repTargets: Target = performanceMetrics.reduce((acc, metric) => {
          acc[metric] = monthlyTargets[metric] / salesRepresentatives.length;
          return acc;
      }, {} as Record<PerformanceMetric, number>);

      salesRepresentatives.forEach((rep) => {
        const currentTotals = repTotals[rep.id];
        
        const forecastTotals: Record<PerformanceMetric, number> = {} as any;
        for (const metric of performanceMetrics) {
          const currentMonthValue = currentTotals[metric] || 0;
          if (dayOfMonth > 0) {
            forecastTotals[metric] = (currentMonthValue / dayOfMonth) * daysInMonth;
          } else {
            forecastTotals[metric] = 0;
          }
        }

        allReps.push({
          name: rep.name,
          shopName: shop.name,
          achievement: calculateTotalAchievement(currentTotals, repTargets),
          forecastAchievement: calculateTotalAchievement(forecastTotals, repTargets),
        });
      });
    });

    return allReps.sort((a, b) => b.achievement - a.achievement);
  }, [shops, allPerformanceData, allMonthlyTargets]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Award className="text-primary" />
          {t('topSalesReps')}
        </CardTitle>
        <CardDescription>
          {t('repRankingsDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-96">
            <div className="space-y-4 pr-4">
                {rankedSalesReps.map((rep, index) => (
                <div key={index} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 font-medium">
                            <span className="font-bold w-6 text-center">{index + 1}</span>
                            <div>
                            <p>{rep.name}</p>
                            <p className="text-xs text-muted-foreground">
                                {rep.shopName}
                            </p>
                             <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                                <TrendingUp className="h-3 w-3" />
                                <span>EOM: {rep.forecastAchievement.toFixed(1)}%</span>
                            </div>
                            </div>
                        </div>
                        <span className="font-bold text-primary">
                            {rep.achievement.toFixed(1)}%
                        </span>
                    </div>
                    <Progress
                    value={Math.min(rep.achievement, 100)}
                    className="h-2"
                    />
                </div>
                ))}
            </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
