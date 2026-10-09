"use client";

import { useLocale, useTranslations } from "next-intl";
import type { DailyActivityProcedureMetric } from "@/lib/daily-activity";
import type { ProcedureSummary } from "@/lib/procedures";
import type { MetricSettings, Target } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  procedures: ProcedureSummary | null;
  metrics: DailyActivityProcedureMetric[];
  targets: Target;
  metricSettings: MetricSettings;
  canCalculate: boolean;
};

function negativeCount(total: number | undefined, completed: number, pending: number | undefined) {
  return total !== undefined && pending !== undefined ? total - completed - pending : undefined;
}

export function DailyActivityProcedures({ procedures, metrics, targets, metricSettings, canCalculate }: Props) {
  const t = useTranslations("DailyActivity");
  const metricTranslations = useTranslations("Metrics");
  const procedureTranslations = useTranslations("Procedures");
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const count = (value: number | undefined) => value !== undefined && Number.isFinite(value) && value >= 0
    ? number.format(value) : "—";
  const impact = (metric: DailyActivityProcedureMetric["metric"], quantity: number, weighted: boolean) => {
    const target = targets[metric];
    const weight = metricSettings[metric]?.weight;
    if (!canCalculate || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(target) || !(target > 0)) return "—";
    if (weighted && (weight === undefined || !Number.isFinite(weight) || weight < 0)) return "—";
    const value = quantity / target * 100 * (weighted ? weight ?? 0 : 1);
    return Number.isFinite(value) ? t("pp", { value: number.format(value) }) : "—";
  };
  const label = (metric: DailyActivityProcedureMetric["metric"]) => metric === "newLine"
    ? metricTranslations("newLine") : metricSettings.custom_mixmax?.label?.trim() || "MixMax";
  const completedTryBuy = procedures ? procedures.completed - procedures.completedMixMax : 0;
  const products = procedures ? [
    { label: "MixMax", total: procedures.totalMixMax, completed: procedures.completedMixMax, pending: procedures.pendingMixMax,
      negative: negativeCount(procedures.totalMixMax, procedures.completedMixMax, procedures.pendingMixMax), color: "bg-[#4472c4]" },
    { label: "TRY&BUY", total: procedures.totalTryBuy, completed: completedTryBuy, pending: procedures.pendingTryBuy,
      negative: negativeCount(procedures.totalTryBuy, completedTryBuy, procedures.pendingTryBuy), color: "bg-violet-600" },
  ] : [];
  const statusCount = (value: number | undefined, status: "pending" | "negative") => <span className={cn(
    "inline-flex min-h-6 min-w-7 items-center justify-end rounded px-1.5 tabular-nums",
    value === 0 && "text-muted-foreground",
    value !== undefined && value > 0 && (status === "pending"
      ? "bg-yellow-100 font-medium text-yellow-950 dark:bg-yellow-950/60 dark:text-yellow-200"
      : "bg-red-50 font-medium text-red-800 dark:bg-red-950/40 dark:text-red-300"),
  )}>{count(value)}</span>;

  return <section className="space-y-3 rounded-md border p-3" aria-label={t("procedureTitle")}>
    <div className="space-y-1">
      <h2 className="text-sm font-semibold">{t("procedureTitle")}</h2>
      <p className="text-xs text-muted-foreground">{t(procedures ? "procedureSourceNote" : "noProcedureSummary")}</p>
    </div>
    {procedures && <>
      <div className="max-w-md overflow-x-auto rounded border">
        <table className="w-full min-w-[360px] border-collapse text-xs" aria-label={t("totalProcedures")}>
          <thead className="bg-muted/40"><tr>
            <th scope="col" className="px-2 py-2 text-left font-medium">{procedureTranslations("product")}</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">{t("total")}</th>
            {(["done", "pending", "negative"] as const).map(status => <th key={status} scope="col" className={cn(
              "px-2 py-2 text-right font-medium",
              status === "done" && "bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-300",
            )}><span className="inline-flex items-center gap-1"><span aria-hidden="true" className={cn(
              "h-1.5 w-1.5 rounded-full", status === "done" ? "bg-green-600" : status === "pending" ? "bg-yellow-500" : "bg-red-500",
            )} />{t(status)}</span></th>)}
          </tr></thead>
          <tbody>{products.map(product => <tr key={product.label} className="border-t">
            <th scope="row" className="whitespace-nowrap px-2 py-2 text-left font-medium"><span aria-hidden="true" className={cn("mr-1.5 inline-block h-2 w-2 rounded-full", product.color)} />{product.label}</th>
            <td className="px-2 py-2 text-right tabular-nums">{count(product.total)}</td>
            <td className="bg-green-50 px-2 py-2 text-right tabular-nums dark:bg-green-950/30">{count(product.completed)}</td>
            <td className="px-2 py-2 text-right">{statusCount(product.pending, "pending")}</td>
            <td className="px-2 py-2 text-right">{statusCount(product.negative, "negative")}</td>
          </tr>)}</tbody>
          <tfoot className="border-t bg-muted/50 font-semibold"><tr>
            <th scope="row" className="px-2 py-2 text-left">{t("total")}</th>
            <td className="px-2 py-2 text-right tabular-nums">{count(procedures.total)}</td>
            <td className="bg-green-100/60 px-2 py-2 text-right tabular-nums dark:bg-green-950/40">{count(procedures.completed)}</td>
            <td className="px-2 py-2 text-right">{statusCount(procedures.pending, "pending")}</td>
            <td className="px-2 py-2 text-right">{statusCount(procedures.negative, "negative")}</td>
          </tr></tfoot>
        </table>
      </div>
      {metrics.length > 0 && <div className="overflow-x-auto rounded border">
        <table className="w-full min-w-[850px] border-collapse text-xs" aria-label={t("procedureMapping")}>
          <thead className="bg-muted/40"><tr>
            <th scope="col" className="min-w-40 border-r px-3 py-2 text-left font-medium">{t("activity")}</th>
            {(["pending", "pendingKpiImpact", "pendingContribution", "negative", "negativeKpiImpact", "negativeContribution"] as const).map((column, index) => <th key={column} scope="col" className={cn(
              "border-r px-3 py-2 text-right font-medium last:border-r-0",
              index < 3 ? "bg-yellow-50 text-yellow-950 dark:bg-yellow-950/20 dark:text-yellow-200" : "bg-red-50 text-red-800 dark:bg-red-950/20 dark:text-red-300",
            )}>{t(column)}</th>)}
          </tr></thead>
          <tbody>{metrics.map(metric => <tr key={metric.metric} className="border-t">
            <th scope="row" className="border-r px-3 py-2 text-left font-medium">{label(metric.metric)}</th>
            <td className="border-r px-3 py-2 text-right">{statusCount(metric.pending, "pending")}</td>
            <td className="border-r px-3 py-2 text-right tabular-nums">{impact(metric.metric, metric.pending, false)}</td>
            <td className="border-r px-3 py-2 text-right font-medium tabular-nums">{impact(metric.metric, metric.pending, true)}</td>
            <td className="border-r px-3 py-2 text-right">{statusCount(metric.negative, "negative")}</td>
            <td className="border-r px-3 py-2 text-right tabular-nums">{impact(metric.metric, metric.negative, false)}</td>
            <td className="px-3 py-2 text-right font-medium tabular-nums">{impact(metric.metric, metric.negative, true)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      <div className="space-y-1 text-xs text-muted-foreground"><p>{t("procedureMapping")}</p><p>{t("negativeExcluded")}</p></div>
    </>}
  </section>;
}
