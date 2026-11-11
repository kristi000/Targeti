import type { Shop } from "@/lib/types";

export type DashboardSortKey = "shop" | "achievement" | "forecast" | "revenue";

/** One KPI's month-to-date result. `label` is set only for renamed or custom KPIs. */
export type DashboardMetric = {
  id: string;
  label: string | null;
  actual: number;
  target: number;
  achievement: number;
  /** Projected % at month end at the current pace; null once the month is final. */
  forecast?: number | null;
  /** Units per remaining day needed to reach target; 0 when already met, null when no days remain or the month is final. */
  neededPerDay?: number | null;
};

export type DashboardRow = {
  shop: Shop;
  revenue: number;
  totalAchievement: number;
  forecastAchievement: number | null;
  isFinal: boolean;
  hasData: boolean;
  metrics?: DashboardMetric[];
  /** Total % at the import before the latest one, when there was one this month. */
  previousAchievement?: number | null;
  daysRemaining?: number | null;
};

export type DashboardSupervisorRow = {
  id: string;
  name: string;
  shopCount: number;
  activeShops: number;
  shopsAtTarget: number;
  averageAchievement: number;
  forecastAchievement: number | null;
  revenue: number;
  metrics?: DashboardMetric[];
};

export type DashboardRepresentativeRow = {
  id: string;
  name: string;
  shopId: string;
  shopName: string;
  achievement: number;
  forecastAchievement: number | null;
  rank: number;
  metrics?: DashboardMetric[];
};

export type DashboardSummary = {
  average: number;
  forecast: number | null;
  revenue: number;
  allFinal: boolean;
  activeShops: number;
  shopsAtTarget: number;
};
