
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
  type PerformanceData,
  type SalesRepresentative,
} from "@/lib/types";
import { User } from "lucide-react";
import { useTranslations } from "next-intl";
import { calculateTotalAchievement } from "@/lib/utils";

type WorkerPerformanceListProps = {
  salesRepresentatives: SalesRepresentative[];
  performanceData: PerformanceData[];
  monthlyTargets: Target;
};

export function WorkerPerformanceList({
  salesRepresentatives,
  performanceData,
  monthlyTargets,
}: WorkerPerformanceListProps) {
  const t = useTranslations("DetailedDashboard");
  const numberOfSalesReps = salesRepresentatives.length;

  const repPerformance = useMemo(() => {
    if (numberOfSalesReps === 0) return [];

    const repTotals: Record<string, Record<PerformanceMetric, number>> = {};
    salesRepresentatives.forEach(rep => {
        repTotals[rep.id] = performanceMetrics.reduce((acc, metric) => {
            acc[metric] = 0;
            return acc;
        }, {} as Record<PerformanceMetric, number>);
    });

    performanceData.forEach(day => {
        day.reps.forEach(repData => {
            if(repTotals[repData.repId]) {
                performanceMetrics.forEach(metric => {
                    repTotals[repData.repId][metric] += repData[metric];
                });
            }
        });
    });

    const repTargets: Target = performanceMetrics.reduce((acc, metric) => {
        acc[metric] = monthlyTargets[metric] / numberOfSalesReps;
        return acc;
    }, {} as Record<PerformanceMetric, number>);

    return salesRepresentatives.map((rep) => ({
      name: rep.name,
      achievement: calculateTotalAchievement(repTotals[rep.id], repTargets),
    }));
  }, [salesRepresentatives, performanceData, monthlyTargets, numberOfSalesReps]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('salesRepPerformance')}</CardTitle>
        <CardDescription>
          {t('individualPerformance')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {repPerformance.map((rep, index) => (
          <div key={index} className="space-y-2">
            <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 font-medium">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span>{rep.name}</span>
                </div>
                <span className="font-bold text-primary">
                    {rep.achievement.toFixed(1)}%
                </span>
            </div>
            <Progress value={Math.min(rep.achievement, 100)} className="h-2" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
