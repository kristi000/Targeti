import type { Shop } from "@/lib/types";

export type DashboardCursor = {
  hasData: boolean;
  value: string | number;
  name: string;
  id: string;
};

export type DashboardSortKey = "shop" | "achievement" | "forecast" | "revenue";

export type DashboardRow = {
  shop: Shop;
  revenue: number;
  totalAchievement: number;
  forecastAchievement: number | null;
  isFinal: boolean;
  hasData: boolean;
  previousAchievement: number | null;
  previousRevenue: number | null;
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
};

export type DashboardSummary = {
  average: number;
  forecast: number | null;
  revenue: number;
  previousAverage: number | null;
  previousRevenue: number | null;
  allFinal: boolean;
  activeShops: number;
  shopsAtTarget: number;
};
