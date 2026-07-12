"use client";

import { useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Gauge, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { METRIC_CONFIG } from "@/lib/data";
import {
  getMetricOrder,
  type MetricSettings,
  type PerformanceMetric,
  type Target,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "next-intl";

type Column = "metric" | "target" | "actual" | "achievement" | "forecast";
type SortState = { column: Column; direction: "ascending" | "descending" } | null;
type Preferences = { sort: SortState; widths: Record<Column, number> };

const DEFAULT_WIDTHS: Record<Column, number> = {
  metric: 220,
  target: 120,
  actual: 120,
  achievement: 260,
  forecast: 170,
};

const statusStyles = (achievement: number) => achievement >= 100
  ? "text-emerald-700 dark:text-emerald-400"
  : achievement >= 70
    ? "text-amber-700 dark:text-amber-400"
    : "text-red-700 dark:text-red-400";

type PerformanceTableProps = {
  actuals: Record<PerformanceMetric, number>;
  targets: Target;
  metricSettings?: MetricSettings;
  metricOrder?: PerformanceMetric[];
  forecasts?: Record<PerformanceMetric, number>;
  forecastAsOf?: string;
  storageKey: string;
  caption: string;
  simplified?: boolean;
};

export function PerformanceTable({
  actuals,
  targets,
  metricSettings,
  metricOrder,
  forecasts,
  forecastAsOf,
  storageKey,
  caption,
  simplified = false,
}: PerformanceTableProps) {
  const t = useTranslations("DetailedDashboard");
  const tMetric = useTranslations("Metrics");
  const locale = useLocale();
  const storageId = `targeti-table-${storageKey}`;
  const [preferences, setPreferences] = useState<Preferences>(() => {
    if (typeof window === "undefined") return { sort: null, widths: DEFAULT_WIDTHS };
    try {
      const saved = JSON.parse(localStorage.getItem(storageId) || "null") as Partial<Preferences> | null;
      return {
        sort: saved?.sort ?? null,
        widths: { ...DEFAULT_WIDTHS, ...saved?.widths },
      };
    } catch {
      return { sort: null, widths: DEFAULT_WIDTHS };
    }
  });

  const persist = (next: Preferences) => {
    setPreferences(next);
    localStorage.setItem(storageId, JSON.stringify(next));
  };

  const metricLabel = (metric: PerformanceMetric) => metricSettings?.[metric]?.label?.trim() || (metric.startsWith("custom_") ? metric.slice(7) : tMetric(metric));
  const columns: Column[] = simplified
    ? ["metric", "target", "actual", "achievement"]
    : ["metric", "target", "actual", "achievement", "forecast"];
  const labels: Record<Column, string> = {
    metric: t("metric"),
    target: t("target"),
    actual: t("actual"),
    achievement: t("achievement"),
    forecast: t("eomForecast"),
  };

  const metrics = useMemo(() => {
    const ordered = getMetricOrder(metricOrder, Object.keys(targets) as PerformanceMetric[]);
    if (!preferences.sort) return ordered;
    const { column, direction } = preferences.sort;
    const value = (metric: PerformanceMetric): string | number => {
      if (column === "metric") return metricLabel(metric).toLocaleLowerCase(locale);
      if (column === "target") return targets[metric] ?? 0;
      if (column === "actual") return actuals[metric] ?? 0;
      if (column === "forecast") return forecasts?.[metric] ?? -1;
      const target = targets[metric];
      return target > 0 ? ((actuals[metric] ?? 0) / target) * 100 : 0;
    };
    return [...ordered].sort((first, second) => {
      const firstValue = value(first);
      const secondValue = value(second);
      const comparison = typeof firstValue === "string"
        ? firstValue.localeCompare(String(secondValue), locale)
        : firstValue - Number(secondValue);
      return direction === "ascending" ? comparison : -comparison;
    });
  }, [metricOrder, preferences.sort, metricSettings, tMetric, locale, targets, actuals, forecasts]);

  const toggleSort = (column: Column) => {
    const direction = preferences.sort?.column === column && preferences.sort.direction === "ascending"
      ? "descending"
      : "ascending";
    persist({ ...preferences, sort: { column, direction } });
  };

  const startResize = (column: Column, event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = preferences.widths[column];
    const move = (pointerEvent: PointerEvent) => {
      setPreferences(current => ({
        ...current,
        widths: { ...current.widths, [column]: Math.max(90, startWidth + pointerEvent.clientX - startX) },
      }));
    };
    const stop = (pointerEvent: PointerEvent) => {
      const width = Math.max(90, startWidth + pointerEvent.clientX - startX);
      persist({ ...preferences, widths: { ...preferences.widths, [column]: width } });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const reset = () => {
    const defaults = { sort: null, widths: DEFAULT_WIDTHS };
    setPreferences(defaults);
    localStorage.removeItem(storageId);
  };

  const sortIcon = (column: Column) => preferences.sort?.column !== column
    ? <ArrowUpDown className="h-3.5 w-3.5" />
    : preferences.sort.direction === "ascending"
      ? <ArrowUp className="h-3.5 w-3.5" />
      : <ArrowDown className="h-3.5 w-3.5" />;

  const renderValues = (metric: PerformanceMetric, mobile = false) => {
    const actual = actuals[metric] ?? 0;
    const target = targets[metric] ?? 0;
    const achievement = target > 0 ? (actual / target) * 100 : 0;
    const forecast = forecasts?.[metric];
    const forecastPercentage = target > 0 && forecast !== undefined ? (forecast / target) * 100 : undefined;
    const Icon = metric in METRIC_CONFIG ? METRIC_CONFIG[metric as keyof typeof METRIC_CONFIG].icon : Gauge;
    if (mobile) return (
      <div key={metric} className="rounded-lg border p-3">
        <div className="mb-3 flex items-center gap-2 font-medium"><Icon className="h-4 w-4 text-muted-foreground" />{metricLabel(metric)}</div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div><dt className="text-muted-foreground">{t("target")}</dt><dd className="font-medium tabular-nums">{Math.round(target)}</dd></div>
          <div><dt className="text-muted-foreground">{t("actual")}</dt><dd className="font-medium tabular-nums">{actual}</dd></div>
          <div><dt className="text-muted-foreground">{t("achievement")}</dt><dd className={cn("font-semibold tabular-nums", statusStyles(achievement))}>{Math.min(achievement, 120).toFixed(1)}%</dd></div>
          {!simplified && <div><dt className="text-muted-foreground">{t("eomForecast")}</dt><dd className="font-medium tabular-nums">{forecast === undefined ? t("notAvailable") : `${Math.round(forecast)} (${Math.min(forecastPercentage ?? 0, 120).toFixed(1)}%)`}</dd></div>}
        </dl>
      </div>
    );
    return (
      <tr key={metric} className="hover:bg-muted/40">
        <th scope="row" className="px-3 py-3 text-left font-medium"><span className="flex items-center gap-2"><Icon className="h-4 w-4 text-muted-foreground" />{metricLabel(metric)}</span></th>
        <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{Math.round(target)}</td>
        <td className="px-3 py-3 text-right tabular-nums">{actual}</td>
        <td className={cn("px-3 py-3 text-right font-semibold tabular-nums", statusStyles(achievement))}>
          {simplified ? Math.min(achievement, 120).toFixed(1) + "%" : <div className="flex items-center gap-2"><Progress value={Math.min(achievement, 120)} className="h-2 flex-1" /><span className="w-14">{Math.min(achievement, 120).toFixed(1)}%</span></div>}
        </td>
        {!simplified && <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{forecast === undefined ? t("notAvailable") : <>{Math.round(forecast)} <span className="text-xs">({Math.min(forecastPercentage ?? 0, 120).toFixed(1)}%)</span></>}</td>}
      </tr>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        {!simplified && <p className="text-xs text-muted-foreground">{forecastAsOf ? t("forecastAsOf", { date: forecastAsOf }) : t("forecastUnavailable")}</p>}
        <Button type="button" variant="ghost" size="sm" className="ml-auto gap-2" onClick={reset}><RotateCcw className="h-4 w-4" />{t("resetTable")}</Button>
      </div>
      <div className="grid gap-3 md:hidden">{metrics.map(metric => renderValues(metric, true))}</div>
      <div className="hidden overflow-x-auto rounded-md border md:block">
        <table className="w-full min-w-[700px] table-fixed text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground"><tr className="border-b">
            {columns.map(column => <th key={column} scope="col" aria-sort={preferences.sort?.column === column ? preferences.sort.direction : "none"} style={{ width: preferences.widths[column] }} className="group relative px-3 py-2 font-medium"><button type="button" className={cn("flex w-full items-center gap-1.5 hover:text-foreground", column === "metric" || column === "achievement" ? "justify-start" : "justify-end")} onClick={() => toggleSort(column)}>{labels[column]}{sortIcon(column)}</button><span role="separator" aria-orientation="vertical" aria-label={t("resizeColumn", { column: labels[column] })} className="absolute inset-y-1 right-0 w-1 cursor-col-resize touch-none rounded bg-border opacity-0 group-hover:opacity-100" onPointerDown={event => startResize(column, event)} /></th>)}
          </tr></thead>
          <tbody className="divide-y">{metrics.map(metric => renderValues(metric))}</tbody>
        </table>
      </div>
    </div>
  );
}
