
"use client";

import { useMemo } from "react";
import {
  type PerformanceData,
  performanceMetrics,
  type PerformanceMetric,
} from "@/lib/types";
import { Header } from "@/components/header";
import { useShop } from "@/components/shop-provider";
import { ShopPerformanceCard } from "./shop-performance-card";
import Link from "next/link";
import { BarChart, TrendingUp, Award } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { Progress } from "./ui/progress";
import { SalesRepresentativeRanking } from "./sales-representative-ranking";
import { useTranslations } from "next-intl";
import { calculateTotalAchievement } from "@/lib/utils";
import { getDaysInMonth } from "date-fns";

export function DashboardClient() {
  const { shops, allPerformanceData, allMonthlyTargets } = useShop();
  const t = useTranslations("Dashboard");

  const shopPerformances = useMemo(() => {
    const today = new Date();
    const daysInMonth = getDaysInMonth(today);
    const dayOfMonth = today.getDate();

    return shops
      .map((shop) => {
        const performanceData = allPerformanceData[shop.id] || [];
        const monthlyTargets = allMonthlyTargets[shop.id];

        if (!monthlyTargets) {
          return {
            shop,
            totalAchievement: 0,
            forecastAchievement: 0,
          };
        }

        const monthlyTotals = performanceData.reduce(
          (acc, day) => {
            day.reps.forEach(rep => {
              performanceMetrics.forEach((metric) => {
                acc[metric] = (acc[metric] || 0) + rep[metric];
              });
            });
            return acc;
          },
          {} as Record<string, number>
        );

        const forecastTotals: Record<PerformanceMetric, number> = {} as any;
        for (const metric of performanceMetrics) {
          const currentMonthValue = monthlyTotals[metric] || 0;
          if (dayOfMonth > 0) {
            forecastTotals[metric] = (currentMonthValue / dayOfMonth) * daysInMonth;
          } else {
            forecastTotals[metric] = 0;
          }
        }

        const totalAchievement = calculateTotalAchievement(
          monthlyTotals,
          monthlyTargets
        );

        const forecastAchievement = calculateTotalAchievement(
            forecastTotals,
            monthlyTargets
        );

        return {
          shop,
          totalAchievement,
          forecastAchievement,
        };
      })
      .sort((a, b) => b.totalAchievement - a.totalAchievement);
  }, [shops, allPerformanceData, allMonthlyTargets]);
  
  const averagePerformance = useMemo(() => {
    if (shopPerformances.length === 0) {
      return 0;
    }
    const total = shopPerformances.reduce(
      (acc, p) => acc + p.totalAchievement,
      0
    );
    return total / shopPerformances.length;
  }, [shopPerformances]);

  const averageForecastPerformance = useMemo(() => {
    if (shopPerformances.length === 0) {
        return 0;
    }
    const total = shopPerformances.reduce(
        (acc, p) => acc + p.forecastAchievement,
        0
    );
    return total / shopPerformances.length;
  }, [shopPerformances]);

  return (
    <div className="flex h-full flex-col">
      <Header title={t('title')} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          <div className="lg:col-span-2 space-y-6">
            <h2 className="text-2xl font-semibold">{t('shopPerformanceRankings')}</h2>
            <div className="space-y-4">
              {shopPerformances.map(({ shop, totalAchievement, forecastAchievement }) => (
                <Link key={shop.id} href={`/shop/${shop.id}`} passHref>
                  <ShopPerformanceCard
                    shopName={shop.name}
                    totalPerformance={totalAchievement}
                    forecastPerformance={forecastAchievement}
                  />
                </Link>
              ))}
            </div>
          </div>
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart className="text-primary" />
                  {t('networkAverage')}
                </CardTitle>
                <CardDescription>{t('averagePerformance')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-3xl font-bold">{averagePerformance.toFixed(1)}%</p>
                <Progress value={Math.min(averagePerformance, 100)} className="h-3" />
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                    <TrendingUp className="h-3 w-3" />
                    <span>EOM: {averageForecastPerformance.toFixed(1)}%</span>
                </div>
              </CardContent>
            </Card>
            <SalesRepresentativeRanking />
          </div>
        </div>
      </div>
    </div>
  );
}
