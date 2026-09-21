import { queryOptions } from "@tanstack/react-query";

import { fetchShopPerformanceForMonth, fetchShopPerformanceIndex } from "@/app/actions/shop-data";
import { fetchPerformanceDataForMonth } from "@/app/dashboard-actions";
import { performanceMonthQueryKey, shopPerformanceIndexQueryKey, shopPerformanceMonthQueryKey } from "@/lib/query-keys";

export const performanceStaleTime = 60_000;

export function shopPerformanceIndexQueryOptions(shopId: string) {
  return queryOptions({
    queryKey: shopPerformanceIndexQueryKey(shopId),
    queryFn: () => fetchShopPerformanceIndex(shopId),
    staleTime: performanceStaleTime,
  });
}

export function shopPerformanceMonthQueryOptions(shopId: string, month: string) {
  return queryOptions({
    queryKey: shopPerformanceMonthQueryKey(shopId, month),
    queryFn: () => fetchShopPerformanceForMonth(shopId, month),
    staleTime: performanceStaleTime,
  });
}

export function performanceMonthQueryOptions(month: string) {
  return queryOptions({
    queryKey: performanceMonthQueryKey(month),
    queryFn: () => fetchPerformanceDataForMonth(month),
    staleTime: performanceStaleTime,
  });
}
