import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { RankBadge, achievementTone, formatMetricValue, metricFullLabel, metricShortLabel, toneText } from "@/components/dashboard-ui";
import type { DashboardMetric } from "@/lib/dashboard-types";
import { cn } from "@/lib/utils";

/** A KPI counts as weak when it is forecast to end the month under this %. */
export const WEAK_FORECAST_THRESHOLD = 90;

export type KpiCellMode = "progress" | "perDay";

/** Sort keys shared by every tab. KPI columns use `metric:<id>`. */
export type KpiSortKey = "name" | "total" | "forecast" | "revenue" | `metric:${string}`;
export type KpiSort = { key: KpiSortKey; desc: boolean };

export type KpiTableRow = {
  key: string;
  name: ReactNode;
  plainName: string;
  detail: ReactNode;
  plainDetail: string;
  total: number | null;
  change?: number | null;
  forecast: number | null;
  isFinal?: boolean;
  revenue?: number | null;
  metrics?: DashboardMetric[];
  selected?: boolean;
  ariaLabel: string;
  onOpen: () => void;
};

export function isWeakMetric(metric: DashboardMetric) {
  return typeof metric.forecast === "number" && metric.forecast < WEAK_FORECAST_THRESHOLD;
}

/** Every KPI that appears in the rows, in first-seen order. */
export function collectMetricColumns(rows: ReadonlyArray<{ metrics?: DashboardMetric[] }>) {
  const columns = new Map<string, DashboardMetric>();
  rows.forEach(row => row.metrics?.forEach(metric => { if (!columns.has(metric.id)) columns.set(metric.id, metric); }));
  return [...columns.values()];
}

/** Value used when sorting by a KPI column; rows without that KPI always go last. */
export function metricSortValue(metrics: DashboardMetric[] | undefined, metricId: string) {
  return metrics?.find(metric => metric.id === metricId)?.achievement ?? null;
}

export function compareNullable(left: number | null, right: number | null, desc: boolean) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return desc ? right - left : left - right;
}

const headerCellClass = "sticky top-0 z-[2] border-b border-border/60 bg-[hsl(var(--glass-tint)/0.92)] py-1.5 backdrop-blur";
const stickyCellClass = "sticky left-0 z-[1] bg-[hsl(var(--glass-tint)/0.92)] backdrop-blur";

export function KpiTable({ rows, nameLabel, sort, onSort, cellMode, currency, showRevenue }: {
  rows: KpiTableRow[];
  nameLabel: string;
  sort: KpiSort;
  onSort: (key: KpiSortKey) => void;
  cellMode: KpiCellMode;
  currency: { compact: Intl.NumberFormat; full: Intl.NumberFormat };
  showRevenue: boolean;
}) {
  const metricColumns = collectMetricColumns(rows);
  const header = (key: KpiSortKey, label: ReactNode, align: "left" | "center" | "right", className?: string, title?: string) => {
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.desc ? ArrowDown : ArrowUp;
    return <th key={key} scope="col" title={title} aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"} className={cn(headerCellClass, "px-2", align === "left" ? "text-left" : align === "right" ? "text-right" : "text-center", className)}>
      <button type="button" onClick={() => onSort(key)} className={cn("inline-flex w-full items-center gap-1 uppercase transition-colors hover:text-foreground", active && "text-foreground", align === "left" ? "justify-start" : align === "right" ? "justify-end" : "justify-center")}>
        <span className="whitespace-nowrap">{label}</span><Icon aria-hidden="true" className={cn("h-3 w-3 shrink-0", !active && "opacity-40")} />
      </button>
    </th>;
  };

  return (
    <table className="w-full border-separate border-spacing-0 text-sm">
      <thead><tr className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {header("name", nameLabel, "left", "sticky left-0 z-[3] min-w-[13rem] pl-3")}
        {header("total", "Total", "left", "min-w-[6.5rem]")}
        {header("forecast", "EOM", "center", "min-w-[3.5rem] px-1")}
        {metricColumns.map(metric => header(`metric:${metric.id}`, metricShortLabel(metric), "center", "min-w-[4.5rem] px-1", metricFullLabel(metric)))}
        {showRevenue && header("revenue", "Revenue", "right", "min-w-[5.5rem] pr-3")}
      </tr></thead>
      <tbody>
        {rows.map((row, index) => {
          const metricsById = new Map(row.metrics?.map(metric => [metric.id, metric]));
          return <tr
            key={row.key}
            tabIndex={0}
            aria-label={row.ariaLabel}
            aria-selected={row.selected || undefined}
            onClick={row.onOpen}
            onKeyDown={event => { if (event.key === "Enter") row.onOpen(); }}
            className={cn(
              "group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&>*]:border-b [&>*]:border-border/50 [&>*]:transition-colors hover:[&>*]:bg-foreground/[0.035]",
              row.selected && "[&>*]:bg-indigo-500/10",
            )}
          >
            <th scope="row" className={cn(stickyCellClass, "py-1.5 pl-3 pr-2 text-left font-normal", row.selected && "shadow-[inset_3px_0_0_0_theme(colors.indigo.600)]")}>
              <span className="flex items-center gap-2.5">
                <RankBadge rank={index + 1} />
                <span className="min-w-0 leading-tight">
                  <span className="block whitespace-nowrap text-[13px]">{row.name}</span>
                  <span className="block whitespace-nowrap text-[11px] text-muted-foreground">{row.detail}</span>
                </span>
              </span>
            </th>
            <td className="px-2 py-1.5">
              {row.total === null
                ? <span className="text-xs text-muted-foreground">Not imported</span>
                : <div className="flex items-center gap-2">
                  <span className={cn("w-11 shrink-0 text-xs font-semibold tabular-nums", toneText[achievementTone(row.total)])}>{row.total.toFixed(1)}%</span>
                  <ChangeBadge change={row.change} />
                </div>}
            </td>
            <td className="px-1 py-1.5 text-center text-xs tabular-nums">
              {row.isFinal
                ? <span className="rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-foreground">Final</span>
                : row.forecast === null ? <span className="text-muted-foreground">—</span>
                  : <span className={cn("font-medium", toneText[achievementTone(row.forecast)])}>{row.forecast.toFixed(0)}%</span>}
            </td>
            {metricColumns.map(column => <td key={column.id} className="px-1 py-1 text-center"><MetricCell metric={metricsById.get(column.id)} mode={cellMode} /></td>)}
            {showRevenue && <td className="py-1.5 pl-2 pr-3 text-right text-xs tabular-nums text-foreground">{typeof row.revenue === "number" && row.total !== null ? <span title={currency.full.format(row.revenue)}>{currency.compact.format(row.revenue)}</span> : "—"}</td>}
          </tr>;
        })}
      </tbody>
    </table>
  );
}

function ChangeBadge({ change }: { change?: number | null }) {
  if (change === null || change === undefined) return null;
  const rounded = Math.round(change * 10) / 10;
  const label = rounded === 0 ? "±0.0" : `${rounded > 0 ? "▲ +" : "▼ "}${rounded.toFixed(1)}`;
  return <span
    title="Change since the previous import"
    className={cn("shrink-0 text-[10px] font-medium tabular-nums", rounded > 0 ? "text-emerald-700 dark:text-emerald-400" : rounded < 0 ? "text-rose-700 dark:text-rose-400" : "text-muted-foreground")}
  >{label}</span>;
}

/** One KPI: % on top, then actual/target or the daily amount still needed. Forecast under 90% gets a red mark. */
export function MetricCell({ metric, mode }: { metric?: DashboardMetric; mode: KpiCellMode }) {
  if (!metric) return <span className="text-xs text-muted-foreground">—</span>;
  const weak = isWeakMetric(metric);
  const forecastText = typeof metric.forecast === "number" ? `, forecast ${Math.round(metric.forecast)}%` : "";
  const neededText = typeof metric.neededPerDay === "number" && metric.neededPerDay > 0 ? `, needs ${formatMetricValue(metric.neededPerDay)} a day` : "";
  let detail: ReactNode = `${formatMetricValue(metric.actual)}/${formatMetricValue(metric.target)}`;
  if (mode === "perDay") {
    if (metric.neededPerDay === null || metric.neededPerDay === undefined) detail = "—";
    else if (metric.neededPerDay === 0 || metric.achievement >= 100) detail = <span className="text-emerald-700 dark:text-emerald-400">✓ met</span>;
    else detail = `${formatMetricValue(metric.neededPerDay)}/day`;
  }
  return (
    <span
      className={cn("relative block rounded-md px-1 py-0.5 leading-tight", weak && "bg-rose-500/10 ring-1 ring-inset ring-rose-500/30")}
      title={`${metricFullLabel(metric)}: ${formatMetricValue(metric.actual)} of ${formatMetricValue(metric.target)}${forecastText}${neededText}`}
    >
      {weak && <span aria-hidden="true" className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-rose-500" />}
      <span className={cn("block text-xs font-semibold tabular-nums", toneText[achievementTone(metric.achievement)])}>{Math.round(metric.achievement)}%</span>
      <span className="block whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">{detail}</span>
      {weak && <span className="sr-only">Forecast under {WEAK_FORECAST_THRESHOLD}%</span>}
    </span>
  );
}

export type CardView = "simple" | "detailed";

/** Phone layout: one card per row. Simple shows total and forecast; Detailed adds every KPI in a grid. */
export function KpiCardList({ rows, view, cellMode }: { rows: KpiTableRow[]; view: CardView; cellMode: KpiCellMode }) {
  return (
    <ul className="divide-y divide-border/50">
      {rows.map((row, index) => (
        <li key={row.key}>
          <div
            role="button"
            tabIndex={0}
            aria-label={row.ariaLabel}
            aria-pressed={row.selected || undefined}
            onClick={row.onOpen}
            onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); row.onOpen(); } }}
            className={cn(
              "cursor-pointer px-3 py-2.5 transition-colors active:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
              row.selected && "bg-indigo-500/10 shadow-[inset_3px_0_0_0_theme(colors.indigo.600)]",
            )}
          >
            <div className="flex items-center gap-2.5">
              <RankBadge rank={index + 1} />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm">{row.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{row.detail}</p>
              </div>
              <div className="w-16 shrink-0 text-right leading-tight">
                <p className="text-[10px] text-muted-foreground">Total</p>
                {row.total === null
                  ? <p className="text-xs text-muted-foreground">—</p>
                  : <p className={cn("text-sm font-semibold tabular-nums", toneText[achievementTone(row.total)])}>{row.total.toFixed(1)}%</p>}
                <ChangeBadge change={row.change} />
              </div>
              <div className="w-12 shrink-0 text-right leading-tight">
                <p className="text-[10px] text-muted-foreground">EOM</p>
                {row.isFinal
                  ? <p className="text-xs font-medium text-foreground">Final</p>
                  : row.forecast === null ? <p className="text-xs text-muted-foreground">—</p>
                    : <p className={cn("text-sm font-semibold tabular-nums", toneText[achievementTone(row.forecast)])}>{row.forecast.toFixed(0)}%</p>}
              </div>
            </div>
            {view === "detailed" && row.metrics && row.metrics.length > 0 && (
              <div className="mt-2 grid grid-cols-3 gap-1">
                {row.metrics.map(metric => <MetricGridCell key={metric.id} metric={metric} mode={cellMode} />)}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function MetricGridCell({ metric, mode }: { metric: DashboardMetric; mode: KpiCellMode }) {
  const weak = isWeakMetric(metric);
  let detail: ReactNode = `${formatMetricValue(metric.actual)}/${formatMetricValue(metric.target)}`;
  if (mode === "perDay") {
    if (metric.neededPerDay === null || metric.neededPerDay === undefined) detail = "—";
    else if (metric.neededPerDay === 0 || metric.achievement >= 100) detail = <span className="text-emerald-700 dark:text-emerald-400">✓ met</span>;
    else detail = `${formatMetricValue(metric.neededPerDay)}/day`;
  }
  return (
    <div className={cn("min-w-0 rounded-md bg-foreground/[0.04] px-1.5 py-1 leading-tight", weak && "bg-rose-500/10 ring-1 ring-inset ring-rose-500/30")}>
      <p className="truncate text-[10px] text-muted-foreground">{metricShortLabel(metric)}</p>
      <p className="flex items-baseline justify-between gap-1">
        <span className={cn("text-[11px] font-semibold tabular-nums", toneText[achievementTone(metric.achievement)])}>{Math.round(metric.achievement)}%</span>
        <span className="truncate text-[10px] tabular-nums text-muted-foreground">{detail}</span>
      </p>
      {weak && <span className="sr-only">Forecast under {WEAK_FORECAST_THRESHOLD}%</span>}
    </div>
  );
}
