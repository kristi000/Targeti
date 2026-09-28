"use client";

import { useMemo } from "react";
import { User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PerformanceTable } from "@/components/performance-table";
import { calculateTotalAchievement, cn } from "@/lib/utils";
import { getMetricOrder, type MetricSettings, type PerformanceData, type PerformanceMetric, type SalesRepresentative, type Target } from "@/lib/types";
import { useTranslations } from "next-intl";
import { getEqualRepresentativeTargets } from "@/lib/representative-targets";
import { projectMetrics } from "@/lib/forecast";

type Props = {
  salesRepresentatives: SalesRepresentative[];
  performanceData: PerformanceData[];
  monthlyTargets: Target;
  representativeTargets?: Record<string, Target>;
  metricSettings?: MetricSettings;
  metricOrder?: PerformanceMetric[];
  shopId: string;
  forecastDate?: Date;
  forecastAsOf?: string;
  isFinal: boolean;
  editedActuals?: Record<string, Record<PerformanceMetric, number>>;
  originalActuals?: Record<string, Partial<Record<PerformanceMetric, number>>>;
  onAdjustActual?: (repId: string, metric: PerformanceMetric, delta: -1 | 1) => void;
};

const statusClass = (value: number) => value >= 100 ? "text-emerald-700 dark:text-emerald-400" : value >= 70 ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400";

export function WorkerPerformanceList({ salesRepresentatives, performanceData, monthlyTargets, representativeTargets, metricSettings, metricOrder, shopId, forecastDate, forecastAsOf, isFinal, editedActuals, originalActuals, onAdjustActual }: Props) {
  const t = useTranslations("DetailedDashboard");
  const metrics = useMemo(() => getMetricOrder(metricOrder, Object.keys(monthlyTargets) as PerformanceMetric[]), [metricOrder, monthlyTargets]);
  const representativeData = useMemo(() => {
    const totals = salesRepresentatives.reduce((result, representative) => {
      result[representative.id] = metrics.reduce((values, metric) => ({ ...values, [metric]: 0 }), {} as Record<PerformanceMetric, number>);
      return result;
    }, {} as Record<string, Record<PerformanceMetric, number>>);
    performanceData.forEach(day => day.reps.forEach(rep => metrics.forEach(metric => {
      if (totals[rep.repId]) totals[rep.repId][metric] += rep[metric] || 0;
    })));
    const equalTargets = getEqualRepresentativeTargets(monthlyTargets, metrics, salesRepresentatives.length);
    return salesRepresentatives.map(representative => {
      const actuals = editedActuals?.[representative.id] ?? totals[representative.id];
      const targets = representativeTargets?.[representative.id] ?? equalTargets;
      const forecasts = forecastDate ? projectMetrics(actuals, metrics, forecastDate) : undefined;
      return {
        ...representative,
        totals: actuals,
        targets,
        achievement: calculateTotalAchievement(actuals, targets, metricSettings),
        forecasts,
        forecastAchievement: forecasts ? calculateTotalAchievement(forecasts, targets, metricSettings) : null,
      };
    });
  }, [salesRepresentatives, performanceData, monthlyTargets, representativeTargets, metricSettings, metrics, forecastDate, editedActuals]);
  const eomLabel = (forecastAchievement: number | null) => isFinal
    ? "Final"
    : forecastAchievement === null ? t("notAvailable") : `${forecastAchievement.toFixed(1)}%`;

  return <section id="representative-bonuses" className="scroll-mt-4 space-y-2 sm:space-y-4 xl:col-span-2">
    <div><h2 className="text-base font-semibold sm:text-xl">{t("salesRepPerformance")}</h2><p className="hidden text-sm text-muted-foreground sm:block">{t("individualPerformance")}</p></div>
    <div className="grid gap-2 sm:gap-3 xl:grid-cols-2">
      {representativeData.map(representative => (
        <Card key={representative.id} className="min-w-0 overflow-hidden">
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 px-2 py-2 sm:px-4 sm:py-3">
            <CardTitle className="flex min-w-0 items-center gap-2 text-sm sm:text-base"><User className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="truncate">{representative.name}</span></CardTitle>
            <div className="shrink-0 text-right"><span className={cn("inline-block rounded-md bg-muted px-1.5 py-0.5 text-xs font-semibold sm:px-2 sm:py-1", statusClass(representative.achievement))}>{representative.achievement.toFixed(1)}%</span><p className="text-[11px] text-muted-foreground sm:text-xs">EOM: {eomLabel(representative.forecastAchievement)}</p></div>
          </CardHeader>
          <CardContent className="px-1 pb-2 sm:px-3 sm:pb-3">
            <PerformanceTable actuals={representative.totals} targets={representative.targets} forecasts={representative.forecasts} forecastAsOf={forecastAsOf} isFinal={isFinal} metricSettings={metricSettings} metricOrder={metricOrder} storageKey={`rep-${shopId}-${representative.id}`} caption={t("representativePerformanceTable", { name: representative.name })} originalActuals={originalActuals?.[representative.id]} onAdjustActual={onAdjustActual ? (metric, delta) => onAdjustActual(representative.id, metric, delta) : undefined} compact />
          </CardContent>
        </Card>
      ))}
    </div>
  </section>;
}
