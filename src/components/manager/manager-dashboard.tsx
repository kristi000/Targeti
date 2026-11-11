import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Gauge as GaugeIcon, Target, TrendingUp, Trophy, Zap } from "lucide-react";
import { useTranslations } from "use-intl";

import { useManager } from "@/components/manager/manager-provider";
import { Card, EmptyState, ErrorState, Gauge, IconBox, Initials, LoadingState, Percent, ProgressBar, Section, StatCard, TrendChip } from "@/components/manager/manager-ui";
import { displayShopName, formatMetricValue, metricShortLabel } from "@/components/dashboard-ui";
import { dashboardPageQueryOptions } from "@/lib/dashboard-queries";
import type { DashboardMetric, DashboardRepresentativeRow } from "@/lib/dashboard-types";
import Link from "@/lib/navigation";
import { cn } from "@/lib/utils";

type Status = "onTrack" | "close" | "behind" | "final" | "unknown";

export function ManagerDashboard() {
  const t = useTranslations("Manager");
  const { shop, month, basePath } = useManager();
  const query = useQuery(dashboardPageQueryOptions({ month, search: "", supervisorId: null, sortBy: "achievement", sortDescending: true }));
  const [selectedRep, setSelectedRep] = useState<string | null>(null);

  if (!shop) return <EmptyState>{t("noShop")}</EmptyState>;
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;

  const rankedRows = query.data.rows.filter(row => row.hasData);
  const row = query.data.rows.find(item => item.shop.id === shop.id);
  const rank = rankedRows.findIndex(item => item.shop.id === shop.id) + 1;
  const representatives = query.data.representativeRows.filter(item => item.shopId === shop.id);
  const metrics = row?.metrics ?? [];

  if (!row?.hasData) return <EmptyState>{t("dashboard.noData", { shop: displayShopName(shop.name) })}</EmptyState>;

  const forecast = row.forecastAchievement;
  const status: Status = row.isFinal ? "final" : forecast === null ? "unknown" : forecast >= 100 ? "onTrack" : forecast >= 90 ? "close" : "behind";
  const pace = metrics.filter(metric => (metric.neededPerDay ?? 0) > 0);
  const behind = metrics.filter(metric => metric.forecast !== null && metric.forecast !== undefined && metric.forecast < 90);
  const change = row.previousAchievement !== null && row.previousAchievement !== undefined ? row.totalAchievement - row.previousAchievement : null;
  const onTrackCount = metrics.filter(metric => (metric.forecast ?? metric.achievement) >= 100).length;
  const rep = representatives.find(item => item.id === selectedRep) ?? null;

  return (
    <>
      <div className="mb-2.5 mt-1 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-tight">{t("dashboard.overview")}</h2>
        <span className="text-xs text-muted-foreground">{displayShopName(shop.name)}</span>
      </div>

      <div className="-mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <StatCard
          className="w-[46%] shrink-0 snap-start"
          icon={Target}
          label={t("dashboard.achieved")}
          value={`${Math.round(row.totalAchievement)}%`}
          footer={<TrendChip value={change} suffix=" pts" context={change === null ? t("dashboard.monthToDate") : t("dashboard.sinceLastImport")} />}
        />
        <StatCard
          className="w-[46%] shrink-0 snap-start"
          icon={TrendingUp}
          label={t("dashboard.forecastLabel")}
          value={forecast === null ? "—" : `${Math.round(forecast)}%`}
          footer={<span className="text-[11px] text-muted-foreground">{t(`dashboard.status.${status}`)}</span>}
        />
        <StatCard
          className="w-[46%] shrink-0 snap-start"
          icon={Trophy}
          label={t("dashboard.rankLabel")}
          value={rank > 0 ? `#${rank}` : "—"}
          footer={<Link href={`${basePath}/rankings`} className="text-[11px] font-medium text-primary">{t("dashboard.ofShops", { total: rankedRows.length })}</Link>}
        />
        <StatCard
          className="w-[46%] shrink-0 snap-start"
          icon={CalendarClock}
          label={t("dashboard.daysLeftLabel")}
          value={row.isFinal ? "0" : row.daysRemaining ?? "—"}
          footer={<span className="text-[11px] text-muted-foreground">{row.isFinal ? t("dashboard.monthFinal") : t("dashboard.inProgress")}</span>}
        />
      </div>

      <Card className="mt-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <IconBox icon={GaugeIcon} />
            <p className="text-sm font-semibold">{t("dashboard.healthTitle")}</p>
          </div>
          <Link href={`${basePath}/rankings`} className="manager-card rounded-full px-3 py-1 text-[11px] font-medium">{t("dashboard.viewRanking")}</Link>
        </div>
        <div className="mt-3">
          <Gauge value={forecast ?? row.totalAchievement} label={t(`dashboard.status.${status}`)} sublabel={`${Math.round(forecast ?? row.totalAchievement)}/100`} />
        </div>
        <div className="mt-3 grid grid-cols-3 divide-x divide-border/70 text-center">
          <HealthStat icon={Target} label={t("dashboard.achieved")} value={`${Math.round(row.totalAchievement)}%`} />
          <HealthStat icon={Zap} label={t("dashboard.kpisOnTrack")} value={`${onTrackCount}/${metrics.length}`} />
          <HealthStat icon={Trophy} label={t("dashboard.rankLabel")} value={rank > 0 ? `#${rank}` : "—"} />
        </div>
        <div className="mt-4 space-y-3">
          <BarRow label={t("dashboard.achievedSoFar")} value={row.totalAchievement} color="bg-emerald-500" />
          {forecast !== null && !row.isFinal && <BarRow label={t("dashboard.forecastLabel")} value={forecast} color="bg-primary" />}
        </div>
      </Card>

      {pace.length > 0 && !row.isFinal && (
        <Card className="mt-3">
          <div className="flex items-center gap-2">
            <IconBox icon={Zap} />
            <p className="text-sm font-semibold">{t("dashboard.paceTitle")}</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {pace.map(metric => (
              <span key={metric.id} className="rounded-full border px-2.5 py-1 text-xs">
                <span className="font-semibold tabular-nums">{formatMetricValue(Math.ceil((metric.neededPerDay ?? 0) * 10) / 10)}</span>{" "}
                <span className="text-muted-foreground">{metricShortLabel(metric)}</span>
              </span>
            ))}
          </div>
        </Card>
      )}

      {behind.length > 0 && !row.isFinal && (
        <div className="mt-3 space-y-1.5">
          {behind.slice(0, 3).map(metric => (
            <p key={metric.id} className="flex items-center gap-2 rounded-2xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              {t("dashboard.behindPace", { metric: metricShortLabel(metric), value: Math.round(metric.forecast ?? 0) })}
            </p>
          ))}
        </div>
      )}

      <Section title={t("dashboard.representatives")} aside={representatives.length ? t("dashboard.tapForDetails") : undefined}>
        {representatives.length ? (
          <Card className="px-3">
            <div className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {representatives.map(item => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={item.id === selectedRep}
                  onClick={() => setSelectedRep(item.id === selectedRep ? null : item.id)}
                  className="flex w-16 shrink-0 flex-col items-center gap-1 text-center focus-visible:outline-none"
                >
                  <Initials name={item.name} className={cn("h-12 w-12 text-sm ring-2 ring-transparent ring-offset-2 ring-offset-card transition", item.id === selectedRep && "ring-primary")} />
                  <span className="w-full truncate text-[11px]">{item.name.split(/[.\s]/)[0]}</span>
                  <Percent value={item.achievement} toneValue={item.forecastAchievement ?? item.achievement} className="text-[11px]" />
                </button>
              ))}
            </div>
            {rep && <RepresentativeDetail representative={rep} />}
          </Card>
        ) : <EmptyState>{t("dashboard.noRepresentatives")}</EmptyState>}
      </Section>

      <Section title={t("dashboard.kpis")}>
        <Card className="space-y-4">
          {metrics.map(metric => <MetricBar key={metric.id} metric={metric} />)}
        </Card>
      </Section>
    </>
  );
}

function HealthStat({ icon, label, value }: { icon: typeof Target; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-1">
      <IconBox icon={icon} />
      <span className="truncate text-[11px] text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function BarRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{Math.round(value)}%</span>
      </div>
      <div className="manager-stripes mt-1.5 h-3 overflow-hidden rounded-full">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function MetricBar({ metric }: { metric: DashboardMetric }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate">{metricShortLabel(metric)}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">{formatMetricValue(metric.actual)}</span> / {formatMetricValue(metric.target)}
          <Percent value={metric.achievement} toneValue={metric.forecast ?? metric.achievement} className="ml-2" />
        </span>
      </div>
      <ProgressBar value={metric.achievement} toneValue={metric.forecast ?? metric.achievement} className="mt-1.5 h-2.5" />
    </div>
  );
}

function RepresentativeDetail({ representative }: { representative: DashboardRepresentativeRow }) {
  const t = useTranslations("Manager");
  const metrics = representative.metrics ?? [];
  const best = metrics.length ? metrics.reduce((left, right) => right.achievement > left.achievement ? right : left) : null;
  const weakest = metrics.length ? metrics.reduce((left, right) => right.achievement < left.achievement ? right : left) : null;
  return (
    <div className="mt-3 space-y-3 border-t border-border/70 pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold">{representative.name}</p>
        <Percent value={representative.achievement} toneValue={representative.forecastAchievement ?? representative.achievement} />
      </div>
      {best && weakest && best.id !== weakest.id && (
        <p className="text-xs text-muted-foreground">{t("dashboard.bestAndWeakest", { best: metricShortLabel(best), weakest: metricShortLabel(weakest) })}</p>
      )}
      {representative.forecastAchievement !== null && (
        <p className="text-xs text-muted-foreground">{t("dashboard.forecast", { value: Math.round(representative.forecastAchievement) })}</p>
      )}
      <div className="space-y-3">
        {metrics.map(metric => <MetricBar key={metric.id} metric={metric} />)}
      </div>
    </div>
  );
}
