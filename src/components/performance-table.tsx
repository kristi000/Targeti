"use client";

import { useCallback, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Gauge, Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

const COMPACT_COLUMN_WIDTHS: Record<Column, string> = {
  metric: "",
  target: "w-10 sm:w-16",
  actual: "w-10 sm:w-16",
  achievement: "w-12 sm:w-[68px]",
  forecast: "w-[84px] sm:w-[110px]",
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
  compact?: boolean;
  originalActuals?: Partial<Record<PerformanceMetric, number>>;
  onAdjustActual?: (metric: PerformanceMetric, delta: -1 | 1) => void;
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
  compact = false,
  originalActuals,
  onAdjustActual,
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

  const metricLabel = useCallback((metric: PerformanceMetric) => metric.startsWith("custom_") ? getCustomMetricLabel(metric, metricSettings) : tMetric(metric), [metricSettings, tMetric]);
  const columns: Column[] = ["metric", "target", "actual", "achievement", "forecast"];
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
  }, [metricOrder, preferences.sort, metricLabel, locale, targets, actuals, forecasts]);
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

  const metricName = (metric: PerformanceMetric) => {
    const label = metricLabel(metric);
    return <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="min-w-0 truncate text-left hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{label}</button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] px-3 py-2 text-sm break-words">{label}</PopoverContent>
    </Popover>;
  };

  const numericValue = (fullValue: string, display: ReactNode = fullValue) => compact
    ? <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={fullValue} className="block w-full min-w-0 truncate text-right hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{display}</button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto max-w-[calc(100vw-2rem)] px-3 py-2 text-sm tabular-nums break-words">{fullValue}</PopoverContent>
    </Popover>
    : display;

  const renderValues = (metric: PerformanceMetric) => {
    const actual = actuals[metric] ?? 0;
    const original = originalActuals?.[metric];
    const difference = original === undefined ? 0 : actual - original;
    const target = targets[metric] ?? 0;
    const achievement = target > 0 ? (actual / target) * 100 : 0;
    const forecast = forecasts?.[metric];
    const forecastPercentage = target > 0 && forecast !== undefined ? (forecast / target) * 100 : undefined;
    const achievementLabel = `${Math.min(achievement, 120).toFixed(1)}%`;
    const forecastLabel = forecast === undefined ? "" : `${Math.round(forecast)} (${Math.min(forecastPercentage ?? 0, 120).toFixed(1)}%)`;
    const Icon = metric in METRIC_CONFIG ? METRIC_CONFIG[metric as keyof typeof METRIC_CONFIG].icon : Gauge;
    return (
      <tr key={metric} className={cn("hover:bg-muted/40", compact ? "h-6" : "h-11")}>
        <th scope="row" title={compact ? undefined : metricLabel(metric)} className={cn("text-left font-medium", compact ? "px-0.5 py-0 sm:px-1" : "px-2 py-0")}><span className="flex min-w-0 items-center gap-0.5 sm:gap-1.5"><Icon className="h-3 w-3 shrink-0 text-muted-foreground sm:h-3.5 sm:w-3.5" />{compact ? metricName(metric) : <span className="truncate">{metricLabel(metric)}</span>}</span></th>
        <td title={compact ? undefined : String(Math.round(target))} className={cn("text-right tabular-nums text-muted-foreground", compact ? "truncate px-0.5 py-0 sm:px-1" : "px-3 py-0")}>{numericValue(String(Math.round(target)))}</td>
        <td className={cn("text-right tabular-nums", compact ? "px-0.5 py-0 sm:px-1" : "px-2 py-0")}>
          {onAdjustActual ? <Popover><PopoverTrigger asChild><button type="button" className="block w-full text-right font-medium text-primary underline decoration-dotted underline-offset-2" aria-label={t("adjustActual", { metric: metricLabel(metric), value: actual })}>{actual}</button></PopoverTrigger><PopoverContent align="end" className="w-auto p-2"><div className="flex items-center gap-2"><Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label={t("decreaseActual", { metric: metricLabel(metric) })} disabled={actual <= 0} onClick={() => onAdjustActual(metric, -1)}><Minus className="h-4 w-4" /></Button><span className="min-w-10 text-center font-semibold tabular-nums">{actual}</span><Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label={t("increaseActual", { metric: metricLabel(metric) })} onClick={() => onAdjustActual(metric, 1)}><Plus className="h-4 w-4" /></Button></div>{original !== undefined && <p className="mt-2 text-xs text-muted-foreground">{t("excelOriginal", { value: original })}</p>}</PopoverContent></Popover> : numericValue(String(actual))}
          {original !== undefined && difference !== 0 && <Popover><PopoverTrigger asChild><button type="button" className="block w-full text-right text-[9px] font-semibold text-amber-700 dark:text-amber-300 sm:text-[10px]" aria-label={t("excelDifferenceDetails", { original, difference: difference > 0 ? `+${difference}` : String(difference) })}>{difference > 0 ? `+${difference}` : difference}</button></PopoverTrigger><PopoverContent align="end" className="w-auto p-2 text-xs"><p>{t("excelOriginal", { value: original })}</p><p>{t("excelDifference", { value: difference > 0 ? `+${difference}` : String(difference) })}</p></PopoverContent></Popover>}
        </td>
        <td className={cn("text-right font-semibold tabular-nums", compact ? "truncate px-0.5 py-0 sm:px-1" : "px-2 py-0", statusStyles(achievement))}>
          {numericValue(achievementLabel)}
        </td>
        <td title={compact || forecast === undefined ? undefined : forecastLabel} className={cn("whitespace-nowrap text-right tabular-nums text-muted-foreground", compact ? "overflow-hidden px-0.5 py-0 sm:px-1" : "px-3 py-0")}>{isFinal ? <span className="font-medium text-foreground">Final</span> : forecast === undefined ? t("notAvailable") : numericValue(forecastLabel, <span className="inline-flex items-baseline justify-end gap-0.5 sm:gap-1"><span>{Math.round(forecast)}</span><span className={compact ? "text-[9px] sm:text-xs" : "text-xs"}>({Math.min(forecastPercentage ?? 0, 120).toFixed(1)}%)</span></span>)}</td>
      </tr>
    );
  };

  return (
    <div className="space-y-1.5 sm:space-y-2">
      {!compact && <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{isFinal ? "Completed month · final values" : forecastAsOf ? t("forecastAsOf", { date: forecastAsOf }) : t("forecastUnavailable")}</p>
        <Button type="button" variant="ghost" size="sm" className="ml-auto gap-2" onClick={reset}><RotateCcw className="h-4 w-4" />{t("resetTable")}</Button>
      </div>}
      <div className={cn("w-full rounded-md border", compact ? "overflow-hidden" : "overflow-x-auto")}>
        <table className={cn("w-full table-fixed text-sm", compact ? "text-[10px] sm:text-xs" : "min-w-[650px]")}>
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs"><tr className={cn("border-b", compact ? "h-6" : "h-8")}>
            {columns.map(column => <th key={column} scope="col" aria-sort={preferences.sort?.column === column ? preferences.sort.direction : "none"} style={compact ? undefined : { width: preferences.widths[column] }} className={cn("group relative font-medium", compact ? cn("px-0.5 py-0 sm:px-1", COMPACT_COLUMN_WIDTHS[column]) : "px-2 py-0")}><button type="button" aria-label={labels[column]} className={cn("flex w-full items-center gap-1 hover:text-foreground", column === "metric" ? "justify-start" : "justify-end")} onClick={() => toggleSort(column)}>{compact ? compactLabels[column] : labels[column]}{!compact && sortIcon(column)}</button>{!compact && <span role="separator" aria-orientation="vertical" aria-label={t("resizeColumn", { column: labels[column] })} className="absolute inset-y-1 right-0 w-1 cursor-col-resize touch-none rounded bg-border opacity-0 group-hover:opacity-100" onPointerDown={event => startResize(column, event)} />}</th>)}
          </tr></thead>
          <tbody className="divide-y">{metrics.map(metric => renderValues(metric))}{Array.from({ length: emptyRowCount }, (_, index) => <tr key={`empty-${index}`} aria-hidden="true" className={compact ? "h-6" : "h-11"}><td colSpan={columns.length} /></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
