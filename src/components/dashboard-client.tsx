
"use client";

import { useMemo } from "react";
import {
  type PerformanceData,
  performanceMetrics,
  type PerformanceMetric,
} from "@/lib/types";
import { Header } from "@/components/header";
import { useShop } from "@/components/shop-provider";
import Link from "next/link";
import { SalesRepresentativeRanking } from "./sales-representative-ranking";
import { useTranslations, useLocale } from "next-intl";
import { calculateTotalAchievement } from "@/lib/utils";
import { getDaysInMonth } from "date-fns";

export function DashboardClient() {
  const { shops, allPerformanceData, allMonthlyTargets, loading } = useShop();
  const t = useTranslations("Dashboard");
  const locale = useLocale();

  // Early return if still loading
  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <Header title={t('title')} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="text-muted-foreground">Loading dashboard...</p>
          </div>
        </div>
      </div>
    );
  }

  // Early return if no shops
  if (shops.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <Header title={t('title')} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <p className="text-muted-foreground">No shops found</p>
            <p className="text-sm text-muted-foreground">Add a shop to get started</p>
          </div>
        </div>
      </div>
    );
  }

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

        // Simplified calculation - only process if we have data
        if (performanceData.length === 0) {
          return {
            shop,
            totalAchievement: 0,
            forecastAchievement: 0,
          };
        }

        // Calculate monthly totals more efficiently
        const monthlyTotals = performanceMetrics.reduce((acc, metric) => {
          acc[metric] = performanceData.reduce((sum, day) => {
            return sum + day.reps.reduce((repSum, rep) => repSum + (rep[metric] || 0), 0);
          }, 0);
          return acc;
        }, {} as Record<PerformanceMetric, number>);

        const totalAchievement = calculateTotalAchievement(monthlyTotals, monthlyTargets);
        
        // Simplified forecast calculation
        const forecastAchievement = dayOfMonth > 0 
          ? (totalAchievement / dayOfMonth) * daysInMonth 
          : totalAchievement;

        return {
          shop,
          totalAchievement,
          forecastAchievement,
        };
      })
      .sort((a, b) => b.totalAchievement - a.totalAchievement);
  }, [shops, allPerformanceData, allMonthlyTargets]);
  
  const averagePerformance = useMemo(() => {
    if (shopPerformances.length === 0) return 0;
    const total = shopPerformances.reduce((acc, p) => acc + p.totalAchievement, 0);
    return total / shopPerformances.length;
  }, [shopPerformances]);

  const averageForecastPerformance = useMemo(() => {
    if (shopPerformances.length === 0) return 0;
    const total = shopPerformances.reduce((acc, p) => acc + p.forecastAchievement, 0);
    return total / shopPerformances.length;
  }, [shopPerformances]);

  return (
    <div className="flex h-full flex-col">
      <Header title={t('title')} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Network Overview */}
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-light text-muted-foreground">{t('networkAverage')}</h2>
            <p className="text-6xl font-bold text-primary">{averagePerformance.toFixed(1)}%</p>
            <p className="text-sm text-muted-foreground">{t('averagePerformance')}</p>
          </div>

          {/* Shops List */}
          <div className="space-y-3">
            <h2 className="text-xl font-medium text-center">{t('shopPerformanceRankings')}</h2>
            <div className="space-y-2">
              {shopPerformances.map(({ shop, totalAchievement, forecastAchievement }) => (
                <Link key={shop.id} href={`/${locale}/shop/${shop.id}`} passHref>
                  <div className="group p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-all cursor-pointer">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full bg-primary"></div>
                        <span className="font-medium">{shop.name}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-semibold">{totalAchievement.toFixed(1)}%</div>
                        <div className="text-xs text-muted-foreground">
                          EOM: {forecastAchievement.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Sales Representatives */}
          <div className="pt-4 border-t">
            <SalesRepresentativeRanking />
          </div>
        </div>
      </div>
    </div>
  );
}
