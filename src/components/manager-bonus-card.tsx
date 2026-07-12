"use client";

import { Banknote, BriefcaseBusiness } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { calculateManagerBonus } from "@/lib/manager-bonus";
import type { MetricSettings, PerformanceMetric, Target } from "@/lib/types";
import { getCustomMetricLabel } from "@/lib/metric-definitions";

type ManagerResult = ReturnType<typeof calculateManagerBonus>;
type Props = { monthlyCollection?: number; actuals: Record<string, number>; targets: Target; metrics: readonly PerformanceMetric[]; metricSettings?: MetricSettings; result?: ManagerResult };

export function ManagerBonusCard({ monthlyCollection, actuals, targets, metrics, metricSettings, result: savedResult }: Props) {
  const t = useTranslations("DetailedDashboard");
  const metricT = useTranslations("Metrics");
  const locale = useLocale();
  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "ALL", maximumFractionDigits: 0 });
  if (monthlyCollection === undefined) return <Card id="manager-bonus" className="scroll-mt-4"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><BriefcaseBusiness className="h-5 w-5 text-primary" />{t("managerBonus")}</CardTitle><CardDescription>{t("managerBonusMissingCollection")}</CardDescription></CardHeader></Card>;

  const result = savedResult ?? calculateManagerBonus(monthlyCollection, actuals, targets, metrics, metricSettings);
  return <Card id="manager-bonus" className="scroll-mt-4 overflow-hidden xl:col-span-2">
    <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 px-4 py-3"><div><CardTitle className="flex items-center gap-2 text-base"><BriefcaseBusiness className="h-5 w-5 text-primary" />{t("managerBonus")}</CardTitle><CardDescription>{t("managerBonusDescription", { group: result.groupName, base: currency.format(result.baseBonus) })}</CardDescription></div><div className="text-right"><p className="text-xs text-muted-foreground">{t("estimatedBonus")}</p><p className="flex items-center justify-end gap-1 text-2xl font-bold"><Banknote className="h-5 w-5 text-primary" />{currency.format(result.totalBonus)}</p></div></CardHeader>
    <CardContent className="px-3 pb-3"><div className="overflow-x-auto rounded-md border"><table className="w-full text-sm"><thead className="bg-muted/50 text-muted-foreground"><tr><th className="px-3 py-2 text-left font-medium">{t("category")}</th><th className="px-3 py-2 text-right font-medium">{t("weight")}</th><th className="px-3 py-2 text-right font-medium">{t("achievement")}</th><th className="px-3 py-2 text-right font-medium">{t("payoutRate")}</th><th className="px-3 py-2 text-right font-medium">{t("bonus")}</th></tr></thead><tbody>{result.categories.map(category => <tr key={category.metric} className="border-t"><td className="px-3 py-2">{category.metric.startsWith("custom_") ? getCustomMetricLabel(category.metric, metricSettings) : metricT(category.metric as never)}</td><td className="px-3 py-2 text-right tabular-nums">{(category.weight * 100).toFixed(1)}%</td><td className="px-3 py-2 text-right tabular-nums">{category.achievementPercentage.toFixed(1)}%</td><td className="px-3 py-2 text-right tabular-nums">{category.payoutPercentage.toFixed(1)}%</td><td className="px-3 py-2 text-right font-medium tabular-nums">{currency.format(category.bonus)}</td></tr>)}</tbody></table></div><p className="mt-2 text-xs text-muted-foreground">{t("managerBonusNote")}</p></CardContent>
  </Card>;
}
