"use client";

import { Banknote, TrendingUp, User } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { calculateRepresentativeBonus } from "@/lib/sales-representative-bonus";
import type { MetricSettings, SalesRepresentative } from "@/lib/types";
import { getCustomMetricLabel } from "@/lib/metric-definitions";

type RepresentativeResult = ReturnType<typeof calculateRepresentativeBonus>;
type Props = {
  representatives: SalesRepresentative[];
  results: Record<string, RepresentativeResult>;
  forecasts?: Record<string, RepresentativeResult>;
  forecastAsOf?: string;
  metricSettings?: MetricSettings;
};

export function RepresentativeBonusCards({ representatives, results, forecasts, forecastAsOf, metricSettings }: Props) {
  const t = useTranslations("DetailedDashboard");
  const metricT = useTranslations("Metrics");
  const locale = useLocale();
  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "ALL", useGrouping: false, maximumFractionDigits: 0 });
  const number = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 0 });

  return <div className="grid gap-3 xl:grid-cols-2">{representatives.map(representative => {
    const result = results[representative.id];
    if (!result) return null;
    const forecast = forecasts?.[representative.id];
    const forecastByMetric = new Map(forecast?.categories.map(category => [category.metric, category]));

    return <Card key={representative.id} className="overflow-hidden">
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 px-3 py-2">
        <div className="min-w-0"><CardTitle className="flex items-center gap-1.5 text-sm"><User className="h-3.5 w-3.5 shrink-0 text-primary" />{representative.name}</CardTitle><p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{t("representativeBonusDescription", { group: result.groupName, base: currency.format(result.baseBonus) })}</p></div>
        <p className="flex shrink-0 items-center gap-1 whitespace-nowrap text-lg font-bold tabular-nums"><Banknote className="h-4 w-4 text-primary" />{currency.format(result.totalBonus)}</p>
      </CardHeader>
      {forecast && <div className="border-t bg-muted/30 px-3 py-2"><div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-xs font-medium"><TrendingUp className="h-3.5 w-3.5 text-primary" />{t("eomBonusForecast")}</span><strong className="text-base tabular-nums">{currency.format(forecast.totalBonus)}</strong></div><p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{t("eomBonusForecastBasis", { date: forecastAsOf ?? "", group: forecast.groupName })}{!forecast.shopBonusEligible ? ` · ${t("shopBonusIneligible")}` : ""}</p></div>}
      <CardContent className="px-2 pb-2 pt-1">
        {!result.shopBonusEligible && <p className="mb-1.5 rounded bg-amber-50 px-2 py-1 text-[11px] font-medium leading-tight text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{t("shopBonusIneligible")}</p>}
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[440px] text-[11px] leading-tight">
            <thead className="bg-muted/50 text-muted-foreground"><tr>
              <th scope="col" className="w-[34%] px-1.5 py-1.5 text-left font-medium">{t("category")}</th>
              <th scope="col" className="px-1.5 py-1.5 text-right font-medium">{t("individualBonus")}</th>
              <th scope="col" className="px-1.5 py-1.5 text-right font-medium">{t("shopBonus")}</th>
              <th scope="col" className="whitespace-nowrap px-1.5 py-1.5 text-right font-medium">{t("bonus")} (ALL)</th>
              {forecast && <th scope="col" className="whitespace-nowrap px-1.5 py-1.5 text-right font-medium">{t("eomBonus")} (ALL)<span className="block font-normal">{t("forecastRates")}</span></th>}
            </tr></thead>
            <tbody>{result.categories.map(category => {
              const label = category.metric.startsWith("custom_") ? getCustomMetricLabel(category.metric, metricSettings) : metricT(category.metric as never);
              const projected = forecastByMetric.get(category.metric);
              return <tr key={category.metric} className="border-t">
                <th scope="row" className="max-w-0 truncate px-1.5 py-1 text-left font-medium" title={label}>{label}</th>
                <td className="whitespace-nowrap px-1.5 py-1 text-right tabular-nums"><span className="block text-muted-foreground">{category.individualAchievement.toFixed(1)}% / {category.individualPayout.toFixed(1)}%</span><span>{number.format(category.individualBonus)}</span></td>
                <td className="whitespace-nowrap px-1.5 py-1 text-right tabular-nums"><span className="block text-muted-foreground">{category.shopAchievement.toFixed(1)}% / {category.shopPayout.toFixed(1)}%</span><span>{number.format(category.shopBonus)}</span></td>
                <td className="whitespace-nowrap px-1.5 py-1 text-right font-semibold tabular-nums">{number.format(category.totalBonus)}</td>
                {forecast && <td className="whitespace-nowrap px-1.5 py-1 text-right tabular-nums">{projected && <>
                  <span className="block text-muted-foreground">{t("forecastIndividual")}: {projected.individualAchievement.toFixed(1)}% / {projected.individualPayout.toFixed(1)}%</span>
                  <span className="block text-muted-foreground">{t("forecastShop")}: {projected.shopAchievement.toFixed(1)}% / {projected.shopPayout.toFixed(1)}%</span>
                  <span className="font-semibold">{number.format(projected.totalBonus)}</span>
                </>}</td>}
              </tr>;
            })}</tbody>
          </table>
        </div>
      </CardContent>
    </Card>;
  })}</div>;
}
