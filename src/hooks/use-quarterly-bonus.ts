import { useQueries, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { fetchBonusSnapshot, fetchQuarterlyBonusSnapshot } from "@/server/actions/bonus";
import { shopPerformanceMonthQueryOptions } from "@/lib/performance-queries";
import { bonusSnapshotQueryKey, quarterlyBonusSnapshotQueryKey } from "@/lib/query-keys";
import { calculateQuarterlyBonus, getQuarterMonths, getQuarterlyForecastMonth, getQuarterlyMonthFromSnapshot } from "@/lib/quarterly-bonus";
import type { Shop, Target } from "@/lib/types";

/** "2026-11" → "2026-Q4". */
export function quarterOfMonth(month: string) {
  return `${month.slice(0, 4)}-Q${Math.ceil(Number(month.slice(5, 7)) / 3)}`;
}

/**
 * Quarterly bonus for one shop: the locked quarterly snapshot when there is one, otherwise a preview
 * from the finalized months plus the current month's end-of-month forecast. Shared by the quarterly
 * bonus page and the manager mobile app.
 */
export function useQuarterlyBonus(shop: Shop | null, quarter: string, legacyTargets: Target | undefined) {
  const shopId = shop?.id ?? "";
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
  const forecast = snapshot === null && forecastMonth && monthlyQueries[months.indexOf(forecastMonth)]?.data === null && shop && performanceQuery.data
    ? getQuarterlyForecastMonth(shop, forecastMonth, performanceQuery.data, legacyTargets)
    : null;
  const inputs = months.map((month, index) => monthly[index]
    ? getQuarterlyMonthFromSnapshot(monthly[index])
    : month === forecastMonth ? forecast?.input ?? null : null);
  const previewReady = inputs.every(item => item !== null);
  const result = snapshot?.result ?? (previewReady ? calculateQuarterlyBonus(quarter, inputs.filter((item): item is NonNullable<typeof item> => item !== null)) : null);
  const isPending = (monthlyQueries.some(query => query.isPending) || snapshotQuery.isPending || performanceQuery.isFetching) && !snapshot;
  const isError = (monthlyQueries.some(query => query.isError) || snapshotQuery.isError || performanceQuery.isError) && !snapshot;

  return { months, forecastMonth, monthly, snapshot, forecast, inputs, previewReady, result, isPending, isError };
}
