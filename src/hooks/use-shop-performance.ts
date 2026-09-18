"use client";

import { useQuery } from "@tanstack/react-query";

import { shopPerformanceQueryOptions } from "@/lib/performance-queries";

export function useShopPerformance(shopId: string, enabled: boolean) {
  return useQuery({
    ...shopPerformanceQueryOptions(shopId),
    enabled,
  });
}
