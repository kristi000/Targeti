"use client";

import { useMemo } from "react";
import { User } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { PerformanceTable } from "@/components/performance-table";
import { calculateTotalAchievement, cn } from "@/lib/utils";
import { getMetricOrder, type MetricSettings, type PerformanceData, type PerformanceMetric, type SalesRepresentative, type Target } from "@/lib/types";
import { useTranslations } from "next-intl";

type Props = {
  salesRepresentatives: SalesRepresentative[];
  performanceData: PerformanceData[];
  monthlyTargets: Target;
  metricSettings?: MetricSettings;
  metricOrder?: PerformanceMetric[];
  shopId: string;
};

const statusClass = (value: number) => value >= 100 ? "text-emerald-700 dark:text-emerald-400" : value >= 70 ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400";

export function WorkerPerformanceList({ salesRepresentatives, performanceData, monthlyTargets, metricSettings, metricOrder, shopId }: Props) {
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
    const targets = metrics.reduce((values, metric) => ({ ...values, [metric]: monthlyTargets[metric] / salesRepresentatives.length }), {} as Target);
    return salesRepresentatives.map(representative => ({ ...representative, totals: totals[representative.id], targets, achievement: calculateTotalAchievement(totals[representative.id], targets, metricSettings) }));
  }, [salesRepresentatives, performanceData, monthlyTargets, metricSettings, metrics]);

  return <section className="space-y-4">
    <div><h2 className="text-xl font-semibold">{t("salesRepPerformance")}</h2><p className="text-sm text-muted-foreground">{t("individualPerformance")}</p></div>
    <Accordion type="multiple" className="space-y-3">
      {representativeData.map(representative => <AccordionItem key={representative.id} value={representative.id} className="rounded-lg border px-4">
        <AccordionTrigger className="hover:no-underline"><span className="flex flex-1 items-center justify-between pr-4"><span className="flex items-center gap-2"><User className="h-5 w-5 text-muted-foreground" />{representative.name}</span><span className={cn("rounded-md bg-muted px-2 py-1 text-sm font-semibold", statusClass(representative.achievement))}>{representative.achievement.toFixed(1)}%</span></span></AccordionTrigger>
        <AccordionContent>
          <PerformanceTable actuals={representative.totals} targets={representative.targets} metricSettings={metricSettings} metricOrder={metricOrder} storageKey={`rep-${shopId}-${representative.id}`} caption={t("representativePerformanceTable", { name: representative.name })} simplified />
        </AccordionContent>
      </AccordionItem>)}
    </Accordion>
  </section>;
}
