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
import { getCustomMetricLabel } from "@/lib/metric-definitions";

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

const COMPACT_WIDTHS: Record<Column, number> = {
  metric: 140,
  target: 55,
  actual: 55,
  achievement: 150,
  forecast: 110,
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
  isFinal?: boolean;
  storageKey: string;
  caption: string;
  simplified?: boolean;
  compact?: boolean;
};

export function PerformanceTable({
  actuals,
  targets,
  metricSettings,
  metricOrder,
  forecasts,
  forecastAsOf,
  isFinal = false,
  storageKey,
  caption,
  simplified = false,
  compact = false,
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

  const metricLabel = (metric: PerformanceMetric) => metric.startsWith("custom_") ? getCustomMetricLabel(metric, metricSettings) : tMetric(metric);
  const showForecast = !simplified && (Boolean(forecasts) || isFinal || !compact);
  const columns: Column[] = compact
    ? ["metric", "target", "actual", "achievement", ...(showForecast ? ["forecast" as const] : [])]
    : simplified
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
    const targetMetrics = Object.keys(targets) as PerformanceMetric[];
    const availableMetrics = metricOrder?.length
      ? metricOrder.filter(metric => targetMetrics.includes(metric))
      : targetMetrics;
    const ordered = getMetricOrder(metricOrder, availableMetrics);
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
      <div key={metric} role="listitem" className="px-2.5 py-2.5 sm:px-3 sm:py-3">
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex min-w-0 items-start gap-2 text-sm font-medium"><Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="line-clamp-2 leading-4">{metricLabel(metric)}</span></div>
          <span className={cn("shrink-0 text-sm font-bold tabular-nums", statusStyles(achievement))}>{Math.min(achievement, 120).toFixed(1)}%</span>
        </div>
        <Progress value={achievement} max={120} markerValue={100} className="mt-2 h-1.5" />
        <dl className="mt-1.5 flex items-center justify-between gap-2 text-[11px] sm:text-xs">
          <div className="flex min-w-0 items-center gap-1"><dt className="text-muted-foreground">{t("actual")} / {t("target")}</dt><dd className="font-medium tabular-nums">{actual} / {Math.round(target)}</dd></div>
          {!simplified && <div className="shrink-0"><dt className="sr-only">{t("eomForecast")}</dt><dd className="rounded bg-muted px-1.5 py-0.5 font-medium tabular-nums text-muted-foreground">{isFinal ? "Final" : forecast === undefined ? t("notAvailable") : `EOM ${Math.round(forecast)} · ${Math.min(forecastPercentage ?? 0, 120).toFixed(0)}%`}</dd></div>}
        </dl>
      </div>
    );
    return (
      <tr key={metric} className="hover:bg-muted/40">
        <th scope="row" className={cn("px-2 text-left font-medium", compact ? "py-1" : "py-3")}><span className="flex items-center gap-1.5"><Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{metricLabel(metric)}</span></span></th>
        <td className={cn("text-right tabular-nums text-muted-foreground", compact ? "px-2 py-1" : "px-3 py-3")}>{Math.round(target)}</td>
        <td className={cn("px-2 text-right tabular-nums", compact ? "py-1" : "py-3")}>{actual}</td>
        <td className={cn("px-2 text-right font-semibold tabular-nums", compact ? "py-1" : "py-3", statusStyles(achievement))}>
          {simplified ? Math.min(achievement, 120).toFixed(1) + "%" : <div className="flex items-center gap-2"><Progress value={achievement} max={120} markerValue={100} className="h-2 flex-1" /><span className="w-14">{Math.min(achievement, 120).toFixed(1)}%</span></div>}
        </td>
        {showForecast && <td className={cn("px-3 text-right tabular-nums text-muted-foreground", compact ? "py-1" : "py-3")}>{isFinal ? <span className="font-medium text-foreground">Final</span> : forecast === undefined ? t("notAvailable") : <>{Math.round(forecast)} <span className="text-xs">({Math.min(forecastPercentage ?? 0, 120).toFixed(1)}%)</span></>}</td>}
      </tr>
    );
  };

  return (
    <div className="space-y-1.5 sm:space-y-2">
      {!compact && <div className="flex items-center justify-between gap-3">
        {!simplified && <p className="text-xs text-muted-foreground">{isFinal ? "Completed month · final values" : forecastAsOf ? t("forecastAsOf", { date: forecastAsOf }) : t("forecastUnavailable")}</p>}
        <Button type="button" variant="ghost" size="sm" className="ml-auto gap-2" onClick={reset}><RotateCcw className="h-4 w-4" />{t("resetTable")}</Button>
      </div>}
      <div role="list" aria-label={caption} className="divide-y overflow-hidden rounded-lg border md:hidden">{metrics.map(metric => renderValues(metric, true))}</div>
      <div className="hidden overflow-x-auto rounded-md border md:block">
        <table className={cn("w-full table-fixed text-sm", compact ? (showForecast ? "min-w-[495px] text-xs" : "min-w-[385px] text-xs") : "min-w-[700px]")}>
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground"><tr className="border-b">
            {columns.map(column => <th key={column} scope="col" aria-sort={preferences.sort?.column === column ? preferences.sort.direction : "none"} style={{ width: compact ? COMPACT_WIDTHS[column] : preferences.widths[column] }} className={cn("group relative px-2 font-medium", compact ? "py-1" : "py-2")}><button type="button" className={cn("flex w-full items-center gap-1 hover:text-foreground", column === "metric" || column === "achievement" ? "justify-start" : "justify-end")} onClick={() => toggleSort(column)}>{labels[column]}{sortIcon(column)}</button>{!compact && <span role="separator" aria-orientation="vertical" aria-label={t("resizeColumn", { column: labels[column] })} className="absolute inset-y-1 right-0 w-1 cursor-col-resize touch-none rounded bg-border opacity-0 group-hover:opacity-100" onPointerDown={event => startResize(column, event)} />}</th>)}
          </tr></thead>
          <tbody className="divide-y">{metrics.map(metric => renderValues(metric))}</tbody>
        </table>
      </div>
    </div>
  );
}
