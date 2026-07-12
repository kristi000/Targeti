"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Trophy } from "lucide-react";
import { endOfMonth, format, getDaysInMonth, isWithinInterval, parseISO, startOfMonth, subMonths } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { Header } from "@/components/header";
import { PerformanceTable } from "@/components/performance-table";
import { WorkerPerformanceList } from "@/components/worker-performance-list";
import { useShop } from "@/components/shop-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { calculateTotalAchievement, cn } from "@/lib/utils";
import { getShopMetrics, type PerformanceMetric } from "@/lib/types";

type Period = "current" | "previous" | "custom";

export function DetailedDashboardClient() {
  const { selectedShop, allPerformanceData, allMonthlyTargets } = useShop();
  const t = useTranslations("DetailedDashboard");
  const locale = useLocale();
  const [period, setPeriod] = useState<Period>("current");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const allData = selectedShop ? allPerformanceData[selectedShop.id] || [] : [];
  const monthlyTargets = selectedShop ? allMonthlyTargets[selectedShop.id] : undefined;
  const metrics = useMemo(() => getShopMetrics(selectedShop ?? undefined, monthlyTargets), [selectedShop, monthlyTargets]);
  const now = new Date();
  const selectedRange = useMemo(() => {
    if (period === "current") return { start: startOfMonth(now), end: endOfMonth(now) };
    if (period === "previous") {
      const previous = subMonths(now, 1);
      return { start: startOfMonth(previous), end: endOfMonth(previous) };
    }
    if (!customStart || !customEnd) return null;
    return { start: parseISO(customStart), end: parseISO(customEnd) };
  }, [period, customStart, customEnd]);

  const performanceData = useMemo(() => {
    if (!selectedRange) return [];
    return allData.filter(day => {
      const date = parseISO(day.date);
      return isWithinInterval(date, selectedRange);
    });
  }, [allData, selectedRange]);

  const monthlyTotals = useMemo(() => performanceData.reduce((totals, day) => {
    day.reps.forEach(rep => metrics.forEach(metric => {
      totals[metric] = (totals[metric] || 0) + (rep[metric] || 0);
    }));
    return totals;
  }, {} as Record<PerformanceMetric, number>), [performanceData, metrics]);

  const monthlyAchievement = monthlyTargets
    ? calculateTotalAchievement(monthlyTotals, monthlyTargets, selectedShop?.metricSettings)
    : 0;
  const hasForecast = period === "current" && performanceData.length >= 2;
  const forecastData = useMemo(() => {
    if (!hasForecast) return undefined;
    const dayOfMonth = now.getDate();
    const daysInMonth = getDaysInMonth(now);
    return metrics.reduce((forecast, metric) => {
      forecast[metric] = dayOfMonth > 0 ? ((monthlyTotals[metric] || 0) / dayOfMonth) * daysInMonth : 0;
      return forecast;
    }, {} as Record<PerformanceMetric, number>);
  }, [hasForecast, monthlyTotals, metrics]);

  if (!selectedShop || !monthlyTargets) {
    return <div className="flex h-full flex-col"><Header title={t("title")} /><div className="flex-1 p-4 md:p-6 lg:p-8"><Link href={`/${locale}/`} className={cn(buttonVariants({ variant: "outline" }), "mb-4")}><ArrowLeft className="mr-2" />{t("backToOverview")}</Link><p>{t("shopNotFound")}</p></div></div>;
  }

  return (
    <div className="flex h-full flex-col">
      <Header title={`${t("title")}: ${selectedShop.name}`} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
        <div className="space-y-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <Link href={`/${locale}/`} className={buttonVariants({ variant: "outline" })}><ArrowLeft className="mr-2" />{t("backToOverview")}</Link>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={period} onValueChange={value => setPeriod(value as Period)}>
                <SelectTrigger className="w-44" aria-label={t("reportingPeriod")}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="current">{t("currentMonth")}</SelectItem><SelectItem value="previous">{t("previousMonth")}</SelectItem><SelectItem value="custom">{t("customRange")}</SelectItem></SelectContent>
              </Select>
              {period === "custom" && <><Input type="date" className="w-auto" value={customStart} onChange={event => setCustomStart(event.target.value)} aria-label={t("startDate")} /><Input type="date" className="w-auto" value={customEnd} min={customStart} onChange={event => setCustomEnd(event.target.value)} aria-label={t("endDate")} /></>}
              {(period !== "current" || customStart || customEnd) && <Button variant="ghost" onClick={() => { setPeriod("current"); setCustomStart(""); setCustomEnd(""); }}>{t("resetPeriod")}</Button>}
            </div>
          </div>

          <Card>
            <CardHeader><CardTitle>{t("totalPerformance")}</CardTitle><CardDescription>{t("overallAchievement")}</CardDescription></CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-baseline justify-center gap-2"><Trophy className="h-10 w-10 text-primary" /><p className="text-5xl font-bold tracking-tight">{monthlyAchievement.toFixed(1)}%</p></div>
              <Progress value={monthlyAchievement} className="h-3" />
              <PerformanceTable
                actuals={monthlyTotals}
                targets={monthlyTargets}
                metricSettings={selectedShop.metricSettings}
                metricOrder={metrics}
                forecasts={forecastData}
                forecastAsOf={hasForecast ? format(now, "PP") : undefined}
                storageKey={`shop-${selectedShop.id}`}
                caption={t("performanceTable")}
              />
            </CardContent>
          </Card>

          {selectedShop.salesRepresentatives?.length ? <WorkerPerformanceList salesRepresentatives={selectedShop.salesRepresentatives} performanceData={performanceData} monthlyTargets={monthlyTargets} metricSettings={selectedShop.metricSettings} metricOrder={metrics} shopId={selectedShop.id} /> : null}
        </div>
      </div>
    </div>
  );
}
