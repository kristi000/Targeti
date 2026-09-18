import { queryOptions } from "@tanstack/react-query";

import { fetchPerformanceData } from "@/app/actions/shop-data";
import { fetchPerformanceDataForMonth } from "@/app/dashboard-actions";
import { performanceMonthQueryKey, shopPerformanceQueryKey } from "@/lib/query-keys";

export const performanceStaleTime = 60_000;

export function shopPerformanceQueryOptions(shopId: string) {
  return queryOptions({
    queryKey: shopPerformanceQueryKey(shopId),
    queryFn: () => fetchPerformanceData(shopId),
    staleTime: performanceStaleTime,
    refetchOnWindowFocus: true,
  });
}

export function performanceMonthQueryOptions(month: string) {
  return queryOptions({
    queryKey: performanceMonthQueryKey(month),
    queryFn: () => fetchPerformanceDataForMonth(month),
    staleTime: performanceStaleTime,
  });
}
