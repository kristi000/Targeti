"use client";

import { useMemo } from "react";
import { User } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PerformanceTable } from "@/components/performance-table";
import { calculateTotalAchievement, cn } from "@/lib/utils";
import { getMetricOrder, type MetricSettings, type PerformanceData, type PerformanceMetric, type SalesRepresentative, type Target } from "@/lib/types";
import { useTranslations } from "next-intl";
import { getEqualRepresentativeTargets } from "@/lib/representative-targets";
import { useMediaQuery } from "@/hooks/use-media-query";

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
  const isDesktop = useMediaQuery("(min-width: 1280px)");
  const metrics = useMemo(() => getMetricOrder(metricOrder, Object.keys(monthlyTargets) as PerformanceMetric[]), [metricOrder, monthlyTargets]);
  const representativeData = useMemo(() => {
    const totals = salesRepresentatives.reduce((result, representative) => {
      result[representative.id] = metrics.reduce((values, metric) => ({ ...values, [metric]: 0 }), {} as Record<PerformanceMetric, number>);
      return result;
    }, {} as Record<string, Record<PerformanceMetric, number>>);
    performanceData.forEach(day => day.reps.forEach(rep => metrics.forEach(metric => {
      if (totals[rep.repId]) totals[rep.repId][metric] += rep[metric] || 0;
    })));
    const targets = getEqualRepresentativeTargets(monthlyTargets, metrics, salesRepresentatives.length);
    return salesRepresentatives.map(representative => ({
      ...representative,
      totals: totals[representative.id],
      targets,
      achievement: calculateTotalAchievement(totals[representative.id], targets, metricSettings),
    }));
  }, [salesRepresentatives, performanceData, monthlyTargets, metricSettings, metrics]);

  return <section id="representative-bonuses" className="scroll-mt-4 space-y-2 sm:space-y-4 xl:col-span-2">
  {!isDesktop ? <section className="space-y-2 sm:space-y-4">
    <div><h2 className="text-base font-semibold sm:text-xl">{t("salesRepPerformance")}</h2><p className="hidden text-sm text-muted-foreground sm:block">{t("individualPerformance")}</p></div>
    <Accordion type="multiple" className="space-y-1.5 sm:space-y-3">
      {representativeData.map(representative => <AccordionItem key={representative.id} value={representative.id} className="rounded-lg border px-2.5 sm:px-4">
        <AccordionTrigger className="py-2.5 hover:no-underline sm:py-4"><span className="flex min-w-0 flex-1 items-center justify-between gap-2 pr-2 sm:pr-4"><span className="flex min-w-0 items-center gap-1.5 sm:gap-2"><User className="h-4 w-4 shrink-0 text-muted-foreground sm:h-5 sm:w-5" /><span className="truncate">{representative.name}</span></span><span className={cn("shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs font-semibold sm:px-2 sm:py-1 sm:text-sm", statusClass(representative.achievement))}>{representative.achievement.toFixed(1)}%</span></span></AccordionTrigger>
        <AccordionContent>
          <PerformanceTable actuals={representative.totals} targets={representative.targets} metricSettings={metricSettings} metricOrder={metricOrder} storageKey={`rep-${shopId}-${representative.id}`} caption={t("representativePerformanceTable", { name: representative.name })} simplified />
        </AccordionContent>
      </AccordionItem>)}
    </Accordion>
  </section> : <div className="grid gap-3 xl:grid-cols-2">
  {representativeData.map(representative => (
    <Card key={representative.id} className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between space-y-0 px-4 py-3">
        <CardTitle className="flex items-center gap-2 text-base"><User className="h-4 w-4 text-muted-foreground" />{representative.name}</CardTitle>
        <span className={cn("rounded-md bg-muted px-2 py-1 text-xs font-semibold", statusClass(representative.achievement))}>{representative.achievement.toFixed(1)}%</span>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        <PerformanceTable actuals={representative.totals} targets={representative.targets} metricSettings={metricSettings} metricOrder={metricOrder} storageKey={`rep-${shopId}-${representative.id}`} caption={t("representativePerformanceTable", { name: representative.name })} compact />
      </CardContent>
    </Card>
  ))}
  </div>}
  </section>;
}
