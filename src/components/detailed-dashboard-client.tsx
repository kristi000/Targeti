
"use client";

import { useMemo } from "react";
import { Trophy, CalendarCheck2, ArrowLeft } from "lucide-react";
import {
  type PerformanceMetric,
  performanceMetrics,
} from "@/lib/types";
import { METRIC_CONFIG, METRIC_WEIGHTS } from "@/lib/data";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Header } from "@/components/header";
import { PerformanceChart } from "@/components/performance-chart";
import { useShop } from "@/components/shop-provider";
import { buttonVariants } from "./ui/button";
import Link from "next/link";
import { cn, calculateTotalAchievement } from "@/lib/utils";
import { WorkerPerformanceList } from "./worker-performance-list";
import { useTranslations } from "next-intl";
import { getDaysInMonth } from "date-fns";
import { useLocale } from "next-intl";

export function DetailedDashboardClient() {
  const { selectedShop, allPerformanceData, allMonthlyTargets } = useShop();
  const t = useTranslations("DetailedDashboard");
  const tMetric = useTranslations("Metrics");
  const locale = useLocale();

  const performanceData = selectedShop ? allPerformanceData[selectedShop.id] || [] : [];
  const monthlyTargets = selectedShop ? allMonthlyTargets[selectedShop.id] : undefined;

  const latestDayData = useMemo(() => {
    return performanceData[performanceData.length - 1] || { reps: [] };
  }, [performanceData]);

  const latestDataTotals = useMemo(() => {
    return latestDayData.reps.reduce((acc, rep) => {
        performanceMetrics.forEach(metric => {
            acc[metric] = (acc[metric] || 0) + rep[metric];
        });
        return acc;
    }, {} as Record<PerformanceMetric, number>);
  }, [latestDayData]);


  const monthlyTotals = useMemo(
    () =>
      performanceData.reduce(
        (acc, day) => {
          day.reps.forEach(rep => {
            performanceMetrics.forEach((metric) => {
                acc[metric] = (acc[metric] || 0) + rep[metric];
            });
          });
          return acc;
        },
        {} as Record<PerformanceMetric, number>
      ),
    [performanceData]
  );

  const monthlyAchievement = useMemo(() => {
    if (!monthlyTotals || !monthlyTargets) return 0;
    return calculateTotalAchievement(monthlyTotals, monthlyTargets);
  }, [monthlyTotals, monthlyTargets]);

  const dailyContribution = useMemo(() => {
    if (!latestDataTotals || !monthlyTargets) return 0;
    const weightedContribution = performanceMetrics.reduce((total, metric) => {
      const value = latestDataTotals[metric] ?? 0;
      const target = monthlyTargets[metric];
      const achievementContribution =
        target > 0 ? (value / target) * 100 : 0;
      return total + achievementContribution * METRIC_WEIGHTS[metric];
    }, 0);
    return weightedContribution;
  }, [latestDataTotals, monthlyTargets]);
  
  const aggregatedData = useMemo(() => {
    const aggregatedByDay: Record<string, Record<PerformanceMetric, number>> = {};
    performanceData.forEach(day => {
        const dayTotals = day.reps.reduce((acc, rep) => {
            performanceMetrics.forEach(metric => {
                acc[metric] = (acc[metric] || 0) + rep[metric];
            });
            return acc;
        }, {} as Record<PerformanceMetric, number>);
        aggregatedByDay[day.date] = dayTotals;
    });
    return Object.entries(aggregatedByDay).map(([date, metrics]) => ({ date, ...metrics }));
  }, [performanceData]);
  
  const sortedMetrics = useMemo(() => {
    return [...performanceMetrics].sort(
      (a, b) => METRIC_WEIGHTS[b] - METRIC_WEIGHTS[a]
    );
  }, []);

  const forecastData = useMemo(() => {
    const today = new Date();
    const daysInMonth = getDaysInMonth(today);
    const dayOfMonth = today.getDate();
    const forecast: Record<PerformanceMetric, number> = {} as any;

    for (const metric of performanceMetrics) {
      const currentMonthValue = monthlyTotals[metric] || 0;
      if (dayOfMonth > 0) {
        forecast[metric] = (currentMonthValue / dayOfMonth) * daysInMonth;
      } else {
        forecast[metric] = 0;
      }
    }
    return forecast;
  }, [monthlyTotals]);

  if (!selectedShop || !monthlyTargets) {
        return (
            <div className="flex h-full flex-col">
                <Header title={t('title')} />
                <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
                    <Link href={`/${locale}/`} className={cn(buttonVariants({ variant: "outline" }), "mb-4")}>
                        <ArrowLeft className="mr-2" /> {t('backToOverview')}
                    </Link>
                    <p>{t('shopNotFound')}</p>
                </div>
            </div>
        )
  }

  return (
    <div className="flex h-full flex-col">
       <Header title={`${t('title')}: ${selectedShop.name}`} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
        <div className="space-y-6">
        <Link href={`/${locale}/`} className={cn(buttonVariants({ variant: "outline" }))}>
          <ArrowLeft className="mr-2" /> {t('backToOverview')}
        </Link>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>{t('totalPerformance')}</CardTitle>
                  <CardDescription>{t('overallAchievement')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-baseline justify-center gap-2">
                    <Trophy className="h-10 w-10 text-primary" />
                    <p className="text-5xl font-bold tracking-tight">
                      {monthlyAchievement.toFixed(1)}%
                    </p>
                  </div>
                  <Progress value={monthlyAchievement} className="h-3" />
                  <div className="space-y-4 pt-2">
                    {sortedMetrics.map((metric) => {
                      const value = monthlyTotals[metric as PerformanceMetric] ?? 0;
                      const target = monthlyTargets[metric];
                      const achievement = target > 0 ? (value / target) * 100 : 0;
                      const prediction = forecastData[metric];
                      const predictionPercentage = target > 0 ? (prediction / target) * 100 : 0;
                      const cappedAchievement = Math.min(achievement, 120);
                      const { icon: Icon } = METRIC_CONFIG[metric];

                      return (
                        <div key={metric} className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <Icon className="h-4 w-4 text-muted-foreground" />
                              <span>{tMetric(metric)}</span>
                            </div>
                            <div className="flex items-center gap-2 font-medium">
                              <span>{value}</span>
                              <span className="text-muted-foreground">/</span>
                              <span className="text-muted-foreground">
                                {Math.round(target)}
                              </span>
                              <span className="w-16 text-right font-bold text-primary">
                                {cappedAchievement.toFixed(1)}%
                              </span>
                            </div>
                          </div>
                          <Progress value={cappedAchievement} className="h-2" />
                          <div className="text-xs text-muted-foreground text-right">
                            EOM Prediction: {Math.round(prediction ?? 0)} ({Math.min(predictionPercentage, 120).toFixed(1)}%)
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {performanceData.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('dailyContribution')}</CardTitle>
                    <CardDescription>{t('contributionToGoal')}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-baseline justify-center gap-2">
                      <CalendarCheck2 className="h-10 w-10 text-primary" />
                      <p className="text-5xl font-bold tracking-tight">
                        {dailyContribution.toFixed(1)}%
                      </p>
                    </div>
                      <Progress value={dailyContribution} className="h-3" />
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="lg:col-span-2 space-y-6">
              <PerformanceChart data={aggregatedData} targets={monthlyTargets} />
              {selectedShop.salesRepresentatives && selectedShop.salesRepresentatives.length > 0 && (
                <WorkerPerformanceList
                  salesRepresentatives={selectedShop.salesRepresentatives}
                  performanceData={performanceData}
                  monthlyTargets={monthlyTargets}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
