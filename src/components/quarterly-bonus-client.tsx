"use client";

import { useSearchParams } from "next/navigation";
import { useQueries, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { fetchBonusSnapshot, fetchQuarterlyBonusSnapshot } from "@/app/actions/bonus";
import { Header } from "@/components/header";
import { useShop } from "@/components/shop-provider";
import { shopPerformanceIndexQueryOptions, shopPerformanceMonthQueryOptions } from "@/lib/performance-queries";
import { bonusSnapshotQueryKey, quarterlyBonusSnapshotQueryKey } from "@/lib/query-keys";
import { calculateQuarterlyBonus, getQuarterMonths, getQuarterlyForecastMonth, getQuarterlyMonthFromSnapshot } from "@/lib/quarterly-bonus";
import { getQuarterKey } from "@/lib/types";
import { quarterSchema } from "@/lib/persistence-schemas";

export function QuarterlyBonusClient({ requestedMonth, requestedQuarter }: { requestedMonth?: string; requestedQuarter?: string }) {
  const { selectedShop, allMonthlyTargets } = useShop();
  const t = useTranslations("DetailedDashboard");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const parsedQuarter = quarterSchema.safeParse(searchParams.get("quarter"));
  const selected = parsedQuarter.success ? parsedQuarter.data : requestedQuarter ?? (requestedMonth ? getQuarterKey(requestedMonth) : "");
  const shopId = selectedShop?.id ?? "";
  const indexQuery = useQuery({ ...shopPerformanceIndexQueryOptions(shopId), enabled: Boolean(shopId) });
  const currentQuarter = getQuarterKey(format(new Date(), "yyyy-MM"));
  const quarters = [...new Set([
    currentQuarter,
    ...(parsedQuarter.success ? [parsedQuarter.data] : requestedQuarter ? [requestedQuarter] : []),
    ...(requestedMonth ? [getQuarterKey(requestedMonth)] : []),
    ...Object.keys(selectedShop?.quarterSettings ?? {}),
    ...Object.keys(selectedShop?.monthlyData ?? {}).map(getQuarterKey),
    ...(indexQuery.data ?? []).map(entry => getQuarterKey(entry.date)),
  ])].sort().reverse();
  const quarter = quarters.includes(selected) ? selected : quarters[0];
  const months = getQuarterMonths(quarter);
  const currentMonth = format(new Date(), "yyyy-MM");
  const forecastMonth = months.filter(month => month <= currentMonth).at(-1) ?? "";
  const monthlyQueries = useQueries({ queries: months.map(month => ({
    queryKey: bonusSnapshotQueryKey(shopId, month),
    queryFn: () => fetchBonusSnapshot(shopId, month),
    enabled: Boolean(shopId),
    staleTime: 60_000,
  })) });
  const snapshotQuery = useQuery({
    queryKey: quarterlyBonusSnapshotQueryKey(shopId, quarter),
    queryFn: () => fetchQuarterlyBonusSnapshot(shopId, quarter),
    enabled: Boolean(shopId),
    staleTime: 60_000,
  });
  const performanceQuery = useQuery({
    ...shopPerformanceMonthQueryOptions(shopId, forecastMonth),
    enabled: Boolean(shopId && forecastMonth && snapshotQuery.data === null && monthlyQueries[months.indexOf(forecastMonth)]?.data === null),
  });
  const snapshot = snapshotQuery.data;
  const monthly = months.map((month, index) => monthlyQueries[index].data ?? null);
  const forecast = snapshot === null && forecastMonth && monthlyQueries[months.indexOf(forecastMonth)]?.data === null && selectedShop && performanceQuery.data
    ? getQuarterlyForecastMonth(selectedShop, forecastMonth, performanceQuery.data, allMonthlyTargets[shopId])
    : null;
  const inputs = months.map((month, index) => monthly[index]
    ? getQuarterlyMonthFromSnapshot(monthly[index])
    : month === forecastMonth ? forecast?.input ?? null : null);
  const previewReady = inputs.every(item => item !== null);
  const result = snapshot?.result ?? (previewReady ? calculateQuarterlyBonus(quarter, inputs.filter((item): item is NonNullable<typeof item> => item !== null)) : null);
  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "ALL", maximumFractionDigits: 0 });
  const percent = (value: number | null) => value === null ? "—" : `${value.toFixed(1)}%`;
  const selectQuarter = (value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "quarterly");
    url.searchParams.set("quarter", value);
    url.searchParams.delete("period");
    url.searchParams.delete("kind");
    window.history.replaceState(null, "", url);
  };

  if (!selectedShop) return null;
  return <div className="flex h-full flex-col">
    <Header title={`${t("quarterlyBonus")}: ${selectedShop.name}`} actions={<select aria-label={t("quarter")} className="h-9 rounded-md border bg-background px-3 text-sm" value={quarter} onChange={event => selectQuarter(event.target.value)}>{quarters.map(item => <option key={item} value={item}>{item}</option>)}</select>} />
    <div className="flex-1 overflow-y-auto p-3 md:p-4"><div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-semibold">{t("quarterlyBonus")}</h2><p className="text-sm text-muted-foreground">{t("quarterlyDescription")}</p></div></div>
      {snapshot && <p className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />{t("quarterSnapshotLocked", { date: new Date(snapshot.finalizedAt).toLocaleString(locale) })}</p>}
      {(monthlyQueries.some(query => query.isPending) || snapshotQuery.isPending || performanceQuery.isFetching) && !snapshot ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("loading")}</p> : null}
      {(monthlyQueries.some(query => query.isError) || snapshotQuery.isError || performanceQuery.isError) && !snapshot ? <p className="text-sm text-destructive">{t("tryAgain")}</p> : null}
      {forecast && result && <p className="rounded-md border border-sky-500/40 bg-sky-500/10 p-3 text-sm">{t("quarterForecastNotice", { month: forecastMonth, date: format(forecast.asOfDate, "PP") })}</p>}
      <section className="rounded-lg border bg-card p-4"><h3 className="mb-3 font-semibold">{t("monthlyInputs")}</h3><div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="p-2">{t("monthly")}</th><th className="p-2 text-right">{t("shopPerformance")}</th><th className="p-2 text-right">{t("collection")}</th><th className="p-2 text-right">{t("status")}</th></tr></thead><tbody>{months.map((month, index) => <tr key={month} className="border-b last:border-0"><th className="p-2 text-left font-medium">{month}</th><td className="p-2 text-right">{result ? percent(result.shopMonths[index].performance) : inputs[index] ? percent(inputs[index].shopPerformance) : "—"}</td><td className="p-2 text-right">{result ? currency.format(result.shopMonths[index].collection) : inputs[index] ? currency.format(inputs[index].collection) : "—"}</td><td className="p-2 text-right">{snapshot?.monthlySources.some(item => item.month === month) || monthly[index] ? t("finalized") : month === forecastMonth && forecast ? t("eomForecastStatus") : t("missingSnapshot")}</td></tr>)}</tbody></table></div>{!previewReady && !snapshot && <p className="mt-3 text-sm text-muted-foreground">{t("finalizeMonthsFirst")}</p>}</section>
      {result && <><section className="rounded-lg border bg-card p-4"><h3 className="mb-3 font-semibold">{t("managerQuarterlyBonus")}</h3><div className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6"><Field label={t("averagePerformance")} value={percent(result.shopAverage)} /><Field label={t("averageCollection")} value={currency.format(result.averageCollection)} /><Field label={t("eligibility")} value={result.manager.eligible ? t("eligible") : t("ineligible")} /><Field label={t("collectionGroup")} value={`${result.manager.groupName} · ${currency.format(result.manager.baseBonus)}`} /><Field label={t("payoutRate")} value={percent(result.manager.shopRate)} /><Field label={t("bonus")} value={currency.format(result.manager.totalBonus)} /></div></section>
      <section className="rounded-lg border bg-card p-4"><h3 className="mb-3 font-semibold">{t("representativeQuarterlyBonus")}</h3><div className="overflow-x-auto"><table className="w-full min-w-[960px] text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="p-2">{t("representative")}</th>{months.map(month => <th key={month} className="p-2 text-right">{month}</th>)}<th className="p-2 text-right">{t("averagePerformance")}</th><th className="p-2 text-right">{t("eligibility")}</th><th className="p-2 text-right">{t("collectionGroup")}</th><th className="p-2 text-right">{t("individualBonus")}</th><th className="p-2 text-right">{t("shopBonus")}</th><th className="p-2 text-right">{t("bonus")}</th></tr></thead><tbody>{result.representatives.map(rep => <tr key={rep.id} className="border-b last:border-0"><th className="p-2 text-left font-medium">{rep.name}</th>{rep.monthly.map(item => <td key={item.month} className="p-2 text-right">{percent(item.performance)}</td>)}<td className="p-2 text-right">{percent(rep.individualAverage)}</td><td className="p-2 text-right">{rep.eligible ? t("eligible") : rep.activeAllMonths ? t("ineligible") : t("inactiveMonth")}</td><td className="p-2 text-right">{rep.groupName} · {currency.format(rep.baseBonus)}</td><td className="p-2 text-right">{percent(rep.individualRate)} × 60%</td><td className="p-2 text-right">{percent(rep.shopRate)} × 40%</td><td className="p-2 text-right font-semibold">{currency.format(rep.totalBonus)}</td></tr>)}</tbody></table></div><p className="mt-3 text-right font-semibold">{t("quarterTotal")}: {currency.format(result.totalBonus)}</p></section></>}
    </div></div>
  </div>;
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><p className="text-muted-foreground">{label}</p><p className="font-semibold tabular-nums">{value}</p></div>;
}
