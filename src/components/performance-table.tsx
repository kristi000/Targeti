"use client";

import { useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Gauge, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  metric: 240,
  target: 90,
  actual: 90,
  achievement: 100,
  forecast: 130,
};

const COMPACT_WIDTHS: Record<Column, number> = {
  metric: 130,
  target: 45,
  actual: 45,
  achievement: 65,
  forecast: 80,
};

const STABLE_ROW_COUNT = 8;

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
  const compactLabels: Record<Column, string> = {
    metric: labels.metric,
    target: labels.target,
    actual: labels.actual,
    achievement: "%",
    forecast: "EOM",
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
  const emptyRowCount = Math.max(0, STABLE_ROW_COUNT - metrics.length);

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
      <div key={metric} role="listitem" className="flex h-14 flex-col justify-center px-2.5 sm:px-3">
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex min-w-0 items-start gap-2 text-sm font-medium"><Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="truncate leading-4">{metricLabel(metric)}</span></div>
          <span className={cn("shrink-0 text-sm font-bold tabular-nums", statusStyles(achievement))}>{Math.min(achievement, 120).toFixed(1)}%</span>
        </div>
        <dl className="mt-1.5 flex items-center justify-between gap-2 text-[11px] sm:text-xs">
          <div className="flex min-w-0 items-center gap-1"><dt className="text-muted-foreground">{t("actual")} / {t("target")}</dt><dd className="font-medium tabular-nums">{actual} / {Math.round(target)}</dd></div>
          {!simplified && <div className="shrink-0"><dt className="sr-only">{t("eomForecast")}</dt><dd className="whitespace-nowrap rounded bg-muted px-1.5 py-0.5 font-medium tabular-nums text-muted-foreground">{isFinal ? "Final" : forecast === undefined ? t("notAvailable") : `EOM ${Math.round(forecast)} · ${Math.min(forecastPercentage ?? 0, 120).toFixed(0)}%`}</dd></div>}
        </dl>
      </div>
    );
    return (
      <tr key={metric} className={cn("hover:bg-muted/40", compact ? "h-6" : "h-11")}>
        <th scope="row" className={cn("text-left font-medium", compact ? "px-1 py-0" : "px-2 py-0")}><span className="flex items-center gap-1.5"><Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{metricLabel(metric)}</span></span></th>
        <td className={cn("text-right tabular-nums text-muted-foreground", compact ? "px-1 py-0" : "px-3 py-0")}>{Math.round(target)}</td>
        <td className={cn("text-right tabular-nums", compact ? "px-1 py-0" : "px-2 py-0")}>{actual}</td>
        <td className={cn("text-right font-semibold tabular-nums", compact ? "px-1 py-0" : "px-2 py-0", statusStyles(achievement))}>
          {Math.min(achievement, 120).toFixed(1)}%
        </td>
        {showForecast && <td className={cn("whitespace-nowrap text-right tabular-nums text-muted-foreground", compact ? "px-1 py-0" : "px-3 py-0")}>{isFinal ? <span className="font-medium text-foreground">Final</span> : forecast === undefined ? t("notAvailable") : <span className="inline-flex items-baseline justify-end gap-1"><span>{Math.round(forecast)}</span><span className="text-xs">({Math.min(forecastPercentage ?? 0, 120).toFixed(1)}%)</span></span>}</td>}
      </tr>
    );
  };

  return (
    <div className="space-y-1.5 sm:space-y-2">
      {!compact && <div className="flex items-center justify-between gap-3">
        {!simplified && <p className="text-xs text-muted-foreground">{isFinal ? "Completed month · final values" : forecastAsOf ? t("forecastAsOf", { date: forecastAsOf }) : t("forecastUnavailable")}</p>}
        <Button type="button" variant="ghost" size="sm" className="ml-auto gap-2" onClick={reset}><RotateCcw className="h-4 w-4" />{t("resetTable")}</Button>
      </div>}
      <div role="list" aria-label={caption} className="divide-y overflow-hidden rounded-lg border md:hidden">{metrics.map(metric => renderValues(metric, true))}{Array.from({ length: emptyRowCount }, (_, index) => <div key={`empty-mobile-${index}`} aria-hidden="true" className="h-14" />)}</div>
      <div className="hidden w-full overflow-x-auto rounded-md border md:block">
        <table className={cn("w-full table-fixed text-sm", compact ? (showForecast ? "min-w-[365px] text-xs" : "min-w-[285px] text-xs") : "min-w-[650px]")}>
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground"><tr className={cn("border-b", compact ? "h-6" : "h-8")}>
            {columns.map(column => <th key={column} scope="col" aria-sort={preferences.sort?.column === column ? preferences.sort.direction : "none"} style={{ width: compact ? (column === "metric" ? undefined : COMPACT_WIDTHS[column]) : preferences.widths[column] }} className={cn("group relative font-medium", compact ? "px-1 py-0" : "px-2 py-0")}><button type="button" aria-label={labels[column]} className={cn("flex w-full items-center gap-1 hover:text-foreground", column === "metric" ? "justify-start" : "justify-end")} onClick={() => toggleSort(column)}>{compact ? compactLabels[column] : labels[column]}{!compact && sortIcon(column)}</button>{!compact && <span role="separator" aria-orientation="vertical" aria-label={t("resizeColumn", { column: labels[column] })} className="absolute inset-y-1 right-0 w-1 cursor-col-resize touch-none rounded bg-border opacity-0 group-hover:opacity-100" onPointerDown={event => startResize(column, event)} />}</th>)}
          </tr></thead>
          <tbody className="divide-y">{metrics.map(metric => renderValues(metric))}{Array.from({ length: emptyRowCount }, (_, index) => <tr key={`empty-${index}`} aria-hidden="true" className={compact ? "h-6" : "h-11"}><td colSpan={columns.length} /></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
