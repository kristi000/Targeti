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
  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "ALL", useGrouping: false, maximumFractionDigits: 0 });
  const number = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 0 });
  const forecastByMetric = new Map(forecast?.categories.map(category => [category.metric, category]));
  return <Card id="manager-bonus" className="w-full max-w-[680px] scroll-mt-4 overflow-hidden">
    <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 px-4 py-3"><div><CardTitle className="flex items-center gap-2 text-base"><BriefcaseBusiness className="h-5 w-5 text-primary" />{t("managerBonus")}</CardTitle><CardDescription>{t("managerBonusDescription", { group: result.groupName, base: currency.format(result.baseBonus) })}</CardDescription></div><div className="text-right"><p className="text-xs text-muted-foreground">{t("estimatedBonus")}</p><p className="flex items-center justify-end gap-1 text-2xl font-bold"><Banknote className="h-5 w-5 text-primary" />{currency.format(result.totalBonus)}</p></div></CardHeader>
    {forecast && <div className="border-t bg-muted/30 px-4 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-medium"><TrendingUp className="h-4 w-4 text-primary" />{t("eomBonusForecast")}</span><strong className="text-xl tabular-nums">{currency.format(forecast.totalBonus)}</strong></div><p className="mt-1 text-xs text-muted-foreground">{t("eomBonusForecastBasis", { date: forecastAsOf ?? "", group: forecast.groupName })}</p></div>}
    <CardContent className="px-2 pb-2">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[520px] table-fixed text-xs leading-tight">
          <thead className="bg-muted/50 text-muted-foreground"><tr>
            <th scope="col" className={`${forecast ? "w-2/5" : "w-1/2"} px-3 py-1.5 text-left font-medium`}>{t("category")}</th>
            <th scope="col" className="px-3 py-1.5 text-left font-medium">{t("currentBonus")}<span className="block text-[10px] font-normal">{t("forecastRates")}</span></th>
            {forecast && <th scope="col" className="px-3 py-1.5 text-left font-medium">{t("eomBonus")}<span className="block text-[10px] font-normal">{t("forecastRates")}</span></th>}
          </tr></thead>
          <tbody>{result.categories.map(category => {
            const label = category.metric.startsWith("custom_") ? getCustomMetricLabel(category.metric, metricSettings) : metricT(category.metric as never);
            const projected = forecastByMetric.get(category.metric);
            return <tr key={category.metric} className="border-t align-top">
              <th scope="row" className="break-words px-3 py-1 text-left font-medium">
                <span className="block">{label}</span>
                <span className="block text-[11px] font-normal text-muted-foreground">{t("weight")}: {(category.weight * 100).toFixed(1)}%</span>
              </th>
              <td className="px-3 py-1 tabular-nums">
                <span className="block text-muted-foreground">{category.achievementPercentage.toFixed(1)}% / {category.payoutPercentage.toFixed(1)}%</span>
                <strong className="block text-sm">{number.format(category.bonus)} ALL</strong>
              </td>
              {forecast && <td className="px-3 py-1 tabular-nums">{projected ? <>
                <span className="block text-muted-foreground">{projected.achievementPercentage.toFixed(1)}% / {projected.payoutPercentage.toFixed(1)}%</span>
                <strong className="block text-sm">{number.format(projected.bonus)} ALL</strong>
              </> : t("notAvailable")}</td>}
            </tr>;
          })}</tbody>
        </table>
      </div>
      <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground">{t("managerBonusNote")}</p>
    </CardContent>
  </Card>;
}
