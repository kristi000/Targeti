import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { CheckCircle2, KeyRound } from "lucide-react";
import { useLocale, useTranslations } from "use-intl";

import { useManager } from "@/components/manager/manager-provider";
import { Card, EmptyState, ErrorState, Initials, LoadingState, Percent, ProgressBar, Section, SegmentedControl, formatAmount, formatCompact } from "@/components/manager/manager-ui";
import { metricShortLabel } from "@/components/dashboard-ui";
import { RestrictedAccessDialog } from "@/components/restricted-access";
import { useShop } from "@/components/shop-provider";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useRestrictedAccess } from "@/hooks/use-restricted-access";
import { useShopMonthBonuses } from "@/hooks/use-shop-month-bonuses";
import { fetchBonusHistoryPage } from "@/server/actions/bonus";
import { projectMetrics, projectMonthlyCollection } from "@/lib/forecast";
import { calculateManagerBonus } from "@/lib/manager-bonus";
import { calculateQuarterlyBonus, getQuarterlyForecastMonth, type QuarterlyBonusMonth } from "@/lib/quarterly-bonus";
import { shopPerformanceMonthQueryOptions } from "@/lib/performance-queries";
import { quarterOfMonth, useQuarterlyBonus } from "@/hooks/use-quarterly-bonus";
import { getCustomMetricLabel } from "@/lib/metric-definitions";
import { formatReportingMonth } from "@/lib/reporting-month";
import type { MetricSettings, PerformanceMetric, Shop } from "@/lib/types";

type Tab = "mine" | "quarter" | "representatives" | "history";

/** Highest manager payout is 125% of the base bonus. */
const MAX_PAYOUT_RATE = 1.25;

function metricLabel(metric: PerformanceMetric, settings?: MetricSettings) {
  return metricShortLabel({ id: metric, label: metric.startsWith("custom_") ? getCustomMetricLabel(metric, settings) : null });
}

export function ManagerBonuses() {
  const t = useTranslations("Manager");
  const restricted = useTranslations("RestrictedAccess");
  const { shop } = useManager();
  const access = useRestrictedAccess();
  const [unlockOpen, setUnlockOpen] = useState(false);

  if (!shop) return <EmptyState>{t("noShop")}</EmptyState>;
  if (access.isPending) return <LoadingState />;
  if (access.data !== true) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        <KeyRound aria-hidden="true" className="h-6 w-6" />
        <p>{t("bonuses.locked")}</p>
        <Button variant="outline" size="sm" onClick={() => setUnlockOpen(true)}>{restricted("unlockReports")}</Button>
        <RestrictedAccessDialog open={unlockOpen} onOpenChange={setUnlockOpen} onGranted={() => setUnlockOpen(false)} />
      </div>
    );
  }
  return <UnlockedBonuses shop={shop} />;
}

function UnlockedBonuses({ shop }: { shop: Shop }) {
  const t = useTranslations("Manager");
  const { month } = useManager();
  const { allMonthlyTargets } = useShop();
  const [tab, setTab] = useState<Tab>("mine");
  const bonuses = useShopMonthBonuses(shop, month, allMonthlyTargets[shop.id]);

  return (
    <>
      <SegmentedControl
        label={t("bonuses.view")}
        value={tab}
        onChange={setTab}
        options={[
          { value: "mine", label: t("bonuses.mine") },
          { value: "quarter", label: t("bonuses.quarter") },
          { value: "representatives", label: t("bonuses.representatives") },
          { value: "history", label: t("bonuses.history") },
        ]}
      />
      <div className="mt-4">
        {tab === "history" ? <BonusHistory shopId={shop.id} />
          : tab === "quarter" ? <QuarterlyBonus shop={shop} />
          : bonuses.performanceQuery.isPending ? <LoadingState />
            : bonuses.performanceQuery.isError ? <ErrorState onRetry={() => void bonuses.performanceQuery.refetch()} />
              : bonuses.collection === undefined || !bonuses.targets || !bonuses.managerResult ? <EmptyState>{t("bonuses.noData")}</EmptyState>
                : tab === "mine" ? <MyBonus bonuses={bonuses} />
                  : <RepresentativeBonuses bonuses={bonuses} />}
      </div>
    </>
  );
}

type Bonuses = ReturnType<typeof useShopMonthBonuses>;

function MyBonus({ bonuses }: { bonuses: Bonuses }) {
  const t = useTranslations("Manager");
  const locale = useLocale();
  const { managerResult, snapshot, forecast, metrics, metricSettings, collection, targets, shopActuals } = bonuses;
  const [metric, setMetric] = useState<PerformanceMetric | null>(metrics[0] ?? null);
  const [extra, setExtra] = useState(0);
  const activeMetric = metric && metrics.includes(metric) ? metric : metrics[0] ?? null;

  // Before payroll is final, "what if" adds the extra units on top of the month-end projection,
  // because mid-month results are almost always under the 80% payout threshold.
  const asOfDate = !snapshot && forecast ? forecast.asOfDate : null;
  const whatIf = useMemo(() => {
    if (!activeMetric || collection === undefined || !targets || extra === 0) return null;
    const baseActuals = asOfDate ? projectMetrics(shopActuals, metrics, asOfDate) : shopActuals;
    const baseCollection = asOfDate ? projectMonthlyCollection(collection, asOfDate) : collection;
    return calculateManagerBonus(baseCollection, { ...baseActuals, [activeMetric]: (baseActuals[activeMetric] ?? 0) + extra }, targets, metrics, metricSettings).totalBonus;
  }, [activeMetric, collection, targets, extra, shopActuals, metrics, metricSettings, asOfDate]);

  if (!managerResult) return null;
  const projected = !snapshot && forecast ? forecast.manager.totalBonus : null;
  const headline = projected ?? managerResult.totalBonus;
  const categories = !snapshot && forecast ? forecast.manager.categories : managerResult.categories;
  const maximum = managerResult.baseBonus * MAX_PAYOUT_RATE;
  const sliderMax = activeMetric && targets ? Math.max(10, Math.ceil((targets[activeMetric] ?? 0) * 0.5)) : 10;

  return (
    <>
      <Card className="border-2 border-primary/40">
        <p className="text-xs text-muted-foreground">{snapshot ? t("bonuses.finalBonus") : projected !== null ? t("bonuses.projected") : t("bonuses.soFar")}</p>
        <p className="mt-0.5 text-3xl font-bold tabular-nums">{formatAmount(headline)} <span className="text-sm font-medium text-muted-foreground">ALL</span></p>
        <ProgressBar value={(headline / maximum) * 100} className="mt-3 h-2" />
        <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
          <span>{projected !== null ? t("bonuses.earnedSoFar", { amount: formatAmount(managerResult.totalBonus) }) : managerResult.groupName}</span>
          <span>{t("bonuses.maximum", { amount: formatAmount(maximum) })}</span>
        </div>
        {snapshot && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />{t("bonuses.finalizedOn", { date: new Date(snapshot.finalizedAt).toLocaleDateString(locale) })}
          </p>
        )}
      </Card>

      {!snapshot && activeMetric && (
        <Section title={t("bonuses.whatIf")}>
          <Card>
            <label className="text-xs text-muted-foreground" htmlFor="manager-what-if-metric">{t("bonuses.whatIfMetric")}</label>
            <select
              id="manager-what-if-metric"
              value={activeMetric}
              onChange={event => { setMetric(event.target.value as PerformanceMetric); setExtra(0); }}
              className="mt-1 h-9 w-full rounded-lg border bg-background px-2 text-sm"
            >
              {metrics.map(item => <option key={item} value={item}>{metricLabel(item, metricSettings)}</option>)}
            </select>
            <div className="mt-4 flex items-center gap-3">
              <Slider value={[extra]} min={0} max={sliderMax} step={1} onValueChange={([value]) => setExtra(value)} thumbLabel={t("bonuses.whatIfAmount")} className="flex-1" />
              <span className="w-10 text-right text-sm font-semibold tabular-nums">+{extra}</span>
            </div>
            <p className="mt-3 text-sm">
              {whatIf === null
                ? <span className="text-muted-foreground">{t("bonuses.whatIfHint")}</span>
                : <>
                  {t("bonuses.whatIfResult")}{" "}
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">{formatAmount(whatIf)} ALL</span>
                  <span className="text-muted-foreground"> ({whatIf - headline >= 0 ? "+" : ""}{formatAmount(whatIf - headline)})</span>
                </>}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">{asOfDate ? t("bonuses.whatIfNoteProjected") : t("bonuses.whatIfNote")}</p>
          </Card>
        </Section>
      )}

      <Section title={categories === managerResult.categories ? t("bonuses.byKpi") : t("bonuses.byKpiProjected")} aside={t("bonuses.minimumNote")}>
        <Card className="divide-y divide-border/60 p-0">
          {categories.map(category => (
            <div key={category.metric} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{metricLabel(category.metric, metricSettings)}</span>
                <ProgressBar value={category.achievementPercentage} className="mt-1" />
              </span>
              <Percent value={category.achievementPercentage} className="w-11 text-right text-xs" />
              <span className="w-16 text-right text-xs font-medium tabular-nums">{formatCompact(category.bonus)}</span>
            </div>
          ))}
        </Card>
      </Section>
    </>
  );
}

function RepresentativeBonuses({ bonuses }: { bonuses: Bonuses }) {
  const t = useTranslations("Manager");
  const { displayRepresentatives, representativeResults, forecast, snapshot } = bonuses;
  const results = new Map(representativeResults.map(item => [item.id, item]));
  const projections = new Map((snapshot ? [] : forecast?.representatives ?? []).map(item => [item.id, item.result.totalBonus]));
  const rows = displayRepresentatives
    .map(rep => ({ ...rep, result: results.get(rep.id)?.result, projected: projections.get(rep.id) ?? null }))
    .sort((left, right) => (right.projected ?? right.result?.totalBonus ?? 0) - (left.projected ?? left.result?.totalBonus ?? 0));
  if (!rows.length) return <EmptyState>{t("dashboard.noRepresentatives")}</EmptyState>;
  return (
    <Card className="divide-y divide-border/60 p-0">
      {rows.map(rep => (
        <div key={rep.id} className="flex items-center gap-3 px-4 py-3">
          <Initials name={rep.name} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{rep.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {rep.result
                ? rep.result.shopBonusEligible
                  ? t("bonuses.personalScore", { value: Math.round(rep.result.individualPerformance) })
                  : t("bonuses.notEligible", { value: Math.round(rep.result.individualPerformance) })
                : "—"}
            </span>
          </span>
          <span className="text-right">
            <span className="block text-sm font-semibold tabular-nums">{formatAmount(rep.projected ?? rep.result?.totalBonus ?? 0)}</span>
            <span className="block text-[11px] text-muted-foreground">{rep.projected !== null ? t("bonuses.projectedShort") : t("bonuses.soFarShort")}</span>
          </span>
        </div>
      ))}
    </Card>
  );
}

function BonusHistory({ shopId }: { shopId: string }) {
  const t = useTranslations("Manager");
  const locale = useLocale();
  const history = useQuery({
    queryKey: ["manager", "bonus-history", shopId],
    queryFn: () => fetchBonusHistoryPage(shopId),
    staleTime: 60_000,
  });

  if (history.isPending) return <LoadingState />;
  if (history.isError) return <ErrorState onRetry={() => void history.refetch()} />;

  const rows = history.data.rows.flatMap(row => {
    const manager = row.monthly?.people.find(person => person.role === "manager")?.amount;
    return manager === undefined ? [] : [{ month: row.month, manager, team: row.monthly?.total ?? 0, quarterly: row.quarterly?.people.find(person => person.role === "manager")?.amount ?? null }];
  }).slice(0, 12);
  if (!rows.length) return <EmptyState>{t("bonuses.noHistory")}</EmptyState>;
  const highest = Math.max(...rows.map(row => row.manager), 1);

  return (
    <Card className="space-y-3">
      {rows.map(row => (
        <div key={row.month}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span>{formatReportingMonth(row.month, locale, "short")}</span>
            <span className="font-semibold tabular-nums">{formatAmount(row.manager)} ALL</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-foreground/[0.08]">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(row.manager / highest) * 100}%` }} />
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t("bonuses.teamTotal", { amount: formatAmount(row.team) })}
            {row.quarterly !== null ? ` · ${t("bonuses.quarterly", { amount: formatAmount(row.quarterly) })}` : ""}
          </p>
        </div>
      ))}
    </Card>
  );
}

function QuarterlyBonus({ shop }: { shop: Shop }) {
  const t = useTranslations("Manager");
  const locale = useLocale();
  const { month } = useManager();
  const { allMonthlyTargets } = useShop();
  const quarter = quarterOfMonth(month);
  const { months, forecastMonth, monthly, snapshot, forecast, inputs, result, isPending, isError } = useQuarterlyBonus(shop, quarter, allMonthlyTargets[shop.id]);


  // Past months without a payroll snapshot use their latest imported results.
  const legacyTargets = allMonthlyTargets[shop.id];
  const unfinalizedPast = months.filter((item, index) => item < forecastMonth && !inputs[index]);
  const pastQueries = useQueries({ queries: unfinalizedPast.map(item => ({ ...shopPerformanceMonthQueryOptions(shop.id, item), enabled: !result })) });
  const pastInputs = new Map(unfinalizedPast.map((item, index) => {
    const data = pastQueries[index]?.data;
    return [item, data ? getQuarterlyForecastMonth(shop, item, data, legacyTargets)?.input ?? null : null] as const;
  }));
  const pastKey = unfinalizedPast.map(item => `${item}:${pastInputs.get(item) ? 1 : 0}`).join(",");

  // Until every month of the quarter has a result, estimate the rest from this month's forecast.
  const estimate = useMemo(() => {
    if (result || !forecast) return null;
    const filled = months.map((item, index) => inputs[index]
      ?? pastInputs.get(item)
      ?? (item > forecastMonth ? { ...forecast.input, month: item } satisfies QuarterlyBonusMonth : null));
    if (filled.some(item => !item)) return null;
    return calculateQuarterlyBonus(quarter, filled as QuarterlyBonusMonth[]);
  }, [result, forecast, months, inputs, forecastMonth, quarter, pastKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isPending) return <LoadingState />;
  if (isError) return <EmptyState>{t("loadFailed")}</EmptyState>;
  const shown = result ?? estimate;
  const quarterLabel = `${t("bonuses.quarterShort")}${quarter.slice(-1)} ${quarter.slice(0, 4)}`;

  return (
    <>
      <Card className="border-2 border-primary/40">
        <p className="text-xs text-muted-foreground">
          {snapshot ? t("bonuses.quarterFinal", { quarter: quarterLabel }) : result ? t("bonuses.quarterPreview", { quarter: quarterLabel }) : t("bonuses.quarterEstimate", { quarter: quarterLabel })}
        </p>
        <p className="mt-0.5 text-3xl font-bold tabular-nums">
          {shown ? formatAmount(shown.manager.totalBonus) : "—"} <span className="text-sm font-medium text-muted-foreground">ALL</span>
        </p>
        {shown && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-foreground/[0.05] p-2">
              <p className="text-[11px] text-muted-foreground">{t("bonuses.quarterAverage")}</p>
              <Percent value={shown.shopAverage} toneValue={shown.shopAverage >= 80 ? 100 : shown.shopAverage} className="text-sm" />
            </div>
            <div className="rounded-xl bg-foreground/[0.05] p-2">
              <p className="text-[11px] text-muted-foreground">{t("bonuses.quarterRate")}</p>
              <p className="text-sm font-semibold tabular-nums">{Math.round(shown.manager.shopRate)}%</p>
            </div>
            <div className="rounded-xl bg-foreground/[0.05] p-2">
              <p className="text-[11px] text-muted-foreground">{t("bonuses.quarterBase")}</p>
              <p className="text-sm font-semibold tabular-nums">{formatCompact(shown.manager.baseBonus)}</p>
            </div>
          </div>
        )}
        {snapshot && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />{t("bonuses.finalizedOn", { date: new Date(snapshot.finalizedAt).toLocaleDateString(locale) })}
          </p>
        )}
        {!result && estimate && <p className="mt-3 text-[11px] text-muted-foreground">{t("bonuses.quarterEstimateNote")}</p>}
        {!shown && <p className="mt-2 text-xs text-muted-foreground">{t("bonuses.quarterNoData")}</p>}
      </Card>

      <Section title={t("bonuses.quarterMonths")} aside={t("bonuses.quarterRule")}>
        <Card className="divide-y divide-border/60 p-0">
          {months.map((item, index) => {
            const performance = result ? result.shopMonths[index].performance
              : inputs[index]?.shopPerformance ?? pastInputs.get(item)?.shopPerformance ?? (estimate ? estimate.shopMonths[index].performance : null);
            const status = snapshot?.monthlySources.some(source => source.month === item) || monthly[index] ? "final"
              : item === forecastMonth && forecast ? "forecast"
                : pastInputs.get(item) ? "latestImport"
                  : estimate && item > forecastMonth ? "assumed" : "missing";
            return (
              <div key={item} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block">{formatReportingMonth(item, locale)}</span>
                  <span className="block text-[11px] text-muted-foreground">{t(`bonuses.quarterStatus.${status}`)}</span>
                </span>
                <Percent value={performance} toneValue={performance === null ? null : performance >= 80 ? 100 : performance} />
              </div>
            );
          })}
        </Card>
      </Section>

      {shown && shown.representatives.length > 0 && (
        <Section title={t("bonuses.representatives")}>
          <Card className="divide-y divide-border/60 p-0">
            {[...shown.representatives].sort((left, right) => right.totalBonus - left.totalBonus).map(rep => (
              <div key={rep.id} className="flex items-center gap-3 px-4 py-3">
                <Initials name={rep.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{rep.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {!rep.activeAllMonths ? t("bonuses.quarterInactive")
                      : t("bonuses.quarterRepAverage", { value: Math.round(rep.individualAverage ?? 0) })}
                  </span>
                </span>
                <span className="text-sm font-semibold tabular-nums">{formatAmount(rep.totalBonus)}</span>
              </div>
            ))}
          </Card>
        </Section>
      )}
    </>
  );
}
