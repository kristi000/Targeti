import type { DashboardCursor, DashboardSortKey } from "@/lib/dashboard-types";

export const dashboardPeriodsQueryKey = ["dashboard-periods"] as const;

export function dashboardPageQueryKey(input: {
  month: string;
  search: string;
  supervisorId: string | null;
  pageSize: number;
  cursor: DashboardCursor | null;
  sortBy: DashboardSortKey;
  sortDescending: boolean;
}) {
  return [
    "firestore-shop-performance-page",
    input.month,
    input.search,
    input.supervisorId,
    input.pageSize,
    input.cursor,
    input.sortBy,
    input.sortDescending,
  ] as const;
}

export const dashboardInsightsQueryKey = (month: string) => ["dashboard-insights", month] as const;

export const shopPerformanceQueryKey = (shopId: string) => ["performance", "shop", shopId] as const;

export const bonusSnapshotQueryKey = (shopId: string, month: string) => ["bonus-snapshot", shopId, month] as const;
