import type { LucideIcon } from "lucide-react";

import { METRIC_CONFIG } from "@/lib/data";
import type { DashboardMetric } from "@/lib/dashboard-types";
import { cn } from "@/lib/utils";

/** Shared building blocks for the main dashboard panels. */

export type AchievementTone = "good" | "warn" | "bad" | "muted";

// On target at 100%, close at 90%, behind below that.
export function achievementTone(value: number | null | undefined): AchievementTone {
  if (value === null || value === undefined || !Number.isFinite(value)) return "muted";
  return value >= 100 ? "good" : value >= 90 ? "warn" : "bad";
}

export const toneText: Record<AchievementTone, string> = {
  good: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  bad: "text-rose-700 dark:text-rose-400",
  muted: "text-muted-foreground",
};

export function RankBadge({ rank, className }: { rank: number; className?: string }) {
  return (
    <span className={cn(
      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
      rank <= 3 ? "bg-primary text-primary-foreground shadow-sm" : "bg-foreground/[0.06] text-muted-foreground",
      className,
    )}>{rank}</span>
  );
}

export function KpiTile({ icon: Icon, label, value, hint, tone = "muted" }: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  tone?: AchievementTone;
}) {
  return (
    <div className="glass flex min-w-0 flex-col rounded-[calc(var(--radius)+6px)] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      <p className={cn("mt-1.5 truncate text-2xl font-semibold tabular-nums tracking-tight", tone === "muted" ? "text-foreground" : toneText[tone])}>{value}</p>
      <p className="mt-auto truncate pt-1.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

// Short column labels. These win over labels saved in shop settings; KPIs not listed fall back to their saved label.
const shortMetricLabels: Record<string, string> = {
  newSim: "New Prepaid",
  newLine: "Fiber",
  migrations: "Migrime",
  fixContractRenewal: "Rinovime Fix",
  mobileContractRenewal: "Rinovime Mobile",
  newTv: "HomeNet",
  newPostpaid: "New Postpaid",
  device: "Device",
  custom_mixmax: "MixMax",
};

export function metricShortLabel(metric: Pick<DashboardMetric, "id" | "label">) {
  return shortMetricLabels[metric.id] ?? metric.label ?? metric.id.replace(/^custom_/, "").replace(/_/g, " ");
}

export function metricFullLabel(metric: Pick<DashboardMetric, "id" | "label">) {
  return metric.label ?? (metric.id in METRIC_CONFIG ? METRIC_CONFIG[metric.id as keyof typeof METRIC_CONFIG].label : metricShortLabel(metric));
}

const brandPrefix = /^(one\s+shop|one\s+corner)\s+/i;

/** Shop name without the shared "One Shop" / "One Corner" prefix, so the location reads first. */
export function displayShopName(name: string) {
  return name.replace(brandPrefix, "") || name;
}

export function ShopName({ name, className }: { name: string; className?: string }) {
  return <span className={cn("font-medium text-foreground", className)} title={name}>{displayShopName(name)}</span>;
}

const compactNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const plainNumber = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

export function formatMetricValue(value: number) {
  return Math.abs(value) >= 10_000 ? compactNumber.format(value) : plainNumber.format(value);
}
