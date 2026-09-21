"use client";

import { Banknote, BriefcaseBusiness, TrendingUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { calculateManagerBonus } from "@/lib/manager-bonus";
import type { MetricSettings } from "@/lib/types";
import { getCustomMetricLabel } from "@/lib/metric-definitions";

type ManagerResult = ReturnType<typeof calculateManagerBonus>;
type Props = { result: ManagerResult; forecast?: ManagerResult; forecastAsOf?: string; metricSettings?: MetricSettings };

export function ManagerBonusCard({ result, forecast, forecastAsOf, metricSettings }: Props) {
  const t = useTranslations("DetailedDashboard");
  const metricT = useTranslations("Metrics");
  const locale = useLocale();
  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "ALL", maximumFractionDigits: 0 });
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  return <Card id="manager-bonus" className="scroll-mt-4 overflow-hidden xl:col-span-2">
    <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 px-4 py-3"><div><CardTitle className="flex items-center gap-2 text-base"><BriefcaseBusiness className="h-5 w-5 text-primary" />{t("managerBonus")}</CardTitle><CardDescription>{t("managerBonusDescription", { group: result.groupName, base: currency.format(result.baseBonus) })}</CardDescription></div><div className="text-right"><p className="text-xs text-muted-foreground">{t("estimatedBonus")}</p><p className="flex items-center justify-end gap-1 text-2xl font-bold"><Banknote className="h-5 w-5 text-primary" />{currency.format(result.totalBonus)}</p></div></CardHeader>
    {forecast && <div className="border-t bg-muted/30 px-4 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-medium"><TrendingUp className="h-4 w-4 text-primary" />{t("eomBonusForecast")}</span><strong className="text-xl tabular-nums">{currency.format(forecast.totalBonus)}</strong></div><p className="mt-1 text-xs text-muted-foreground">{t("eomBonusForecastBasis", { date: forecastAsOf ?? "", group: forecast.groupName })}</p></div>}
    <CardContent className="px-2 pb-2"><div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[460px] text-[11px] leading-tight"><thead className="bg-muted/50 text-muted-foreground"><tr><th scope="col" className="w-[38%] px-1.5 py-1.5 text-left font-medium">{t("category")}</th><th scope="col" className="px-1.5 py-1.5 text-right font-medium">{t("weight")}</th><th scope="col" className="px-1.5 py-1.5 text-right font-medium">{t("achievement")}</th><th scope="col" className="px-1.5 py-1.5 text-right font-medium">{t("payoutRate")}</th><th scope="col" className="whitespace-nowrap px-1.5 py-1.5 text-right font-medium">{t("bonus")} (ALL)</th></tr></thead><tbody>{result.categories.map(category => <tr key={category.metric} className="border-t"><th scope="row" className="max-w-0 truncate px-1.5 py-1 text-left font-medium" title={category.metric.startsWith("custom_") ? getCustomMetricLabel(category.metric, metricSettings) : metricT(category.metric as never)}>{category.metric.startsWith("custom_") ? getCustomMetricLabel(category.metric, metricSettings) : metricT(category.metric as never)}</th><td className="whitespace-nowrap px-1.5 py-1 text-right tabular-nums">{(category.weight * 100).toFixed(1)}%</td><td className="whitespace-nowrap px-1.5 py-1 text-right tabular-nums">{category.achievementPercentage.toFixed(1)}%</td><td className="whitespace-nowrap px-1.5 py-1 text-right tabular-nums">{category.payoutPercentage.toFixed(1)}%</td><td className="whitespace-nowrap px-1.5 py-1 text-right font-semibold tabular-nums">{number.format(category.bonus)}</td></tr>)}</tbody></table></div><p className="mt-1.5 text-[11px] leading-tight text-muted-foreground">{t("managerBonusNote")}</p></CardContent>
  </Card>;
}
