"use client";

import { Banknote, User } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { calculateRepresentativeBonus } from "@/lib/sales-representative-bonus";
import type { MetricSettings, PerformanceMetric, SalesRepresentative, Target } from "@/lib/types";
import { getCustomMetricLabel } from "@/lib/metric-definitions";

type RepresentativeResult = ReturnType<typeof calculateRepresentativeBonus>;
type Props = { representatives: SalesRepresentative[]; individualActuals: Record<string, Record<PerformanceMetric, number>>; individualTargets: Record<string, Target>; shopActuals: Record<string, number>; shopTargets: Target; metrics: readonly PerformanceMetric[]; monthlyCollection: number; metricSettings?: MetricSettings; savedResults?: Record<string, RepresentativeResult> };

export function RepresentativeBonusCards({ representatives, individualActuals, individualTargets, shopActuals, shopTargets, metrics, monthlyCollection, metricSettings, savedResults }: Props) {
  const t = useTranslations("DetailedDashboard");
  const metricT = useTranslations("Metrics");
  const locale = useLocale();
  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "ALL", maximumFractionDigits: 0 });
  return <div className="grid gap-4 xl:grid-cols-2">{representatives.map(representative => {
    const result = savedResults?.[representative.id] ?? calculateRepresentativeBonus(monthlyCollection, individualActuals[representative.id], individualTargets[representative.id], shopActuals, shopTargets, metrics, metricSettings);
    return <Card key={representative.id} className="overflow-hidden"><CardHeader className="flex-row items-start justify-between gap-3 space-y-0"><div><CardTitle className="flex items-center gap-2 text-base"><User className="h-4 w-4 text-primary" />{representative.name}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{t("representativeBonusDescription", { group: result.groupName, base: currency.format(result.baseBonus) })}</p></div><p className="flex items-center gap-1 text-xl font-bold"><Banknote className="h-4 w-4 text-primary" />{currency.format(result.totalBonus)}</p></CardHeader><CardContent>{!result.shopBonusEligible && <p className="mb-3 rounded-md bg-amber-50 p-2 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{t("shopBonusIneligible")}</p>}<div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[760px] text-xs"><thead className="bg-muted/50 text-muted-foreground"><tr><th className="px-2 py-2 text-left">{t("category")}</th><th className="px-2 py-2 text-right">Individual achievement / rate</th><th className="px-2 py-2 text-right">Shop achievement / rate</th><th className="px-2 py-2 text-right">{t("individualBonus")}</th><th className="px-2 py-2 text-right">{t("shopBonus")}</th><th className="px-2 py-2 text-right">{t("bonus")}</th></tr></thead><tbody>{result.categories.map(category => <tr key={category.metric} className="border-t"><td className="px-2 py-2">{category.metric.startsWith("custom_") ? getCustomMetricLabel(category.metric, metricSettings) : metricT(category.metric as never)}</td><td className="px-2 py-2 text-right tabular-nums">{category.individualAchievement.toFixed(1)}% / {category.individualPayout.toFixed(1)}%</td><td className="px-2 py-2 text-right tabular-nums">{category.shopAchievement.toFixed(1)}% / {category.shopPayout.toFixed(1)}%</td><td className="px-2 py-2 text-right tabular-nums">{currency.format(category.individualBonus)}</td><td className="px-2 py-2 text-right tabular-nums">{currency.format(category.shopBonus)}</td><td className="px-2 py-2 text-right font-medium tabular-nums">{currency.format(category.totalBonus)}</td></tr>)}</tbody></table></div></CardContent></Card>;
  })}</div>;
}
