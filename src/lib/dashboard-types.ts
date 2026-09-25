import type { Shop } from "@/lib/types";

export type DashboardSortKey = "shop" | "achievement" | "forecast" | "revenue";

export type DashboardRow = {
  shop: Shop;
  revenue: number;
  totalAchievement: number;
  forecastAchievement: number | null;
  isFinal: boolean;
  hasData: boolean;
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

export type DashboardRepresentativeRow = {
  id: string;
  name: string;
  shopId: string;
  shopName: string;
  achievement: number;
  forecastAchievement: number | null;
  rank: number;
};

export type DashboardSummary = {
  average: number;
  forecast: number | null;
  revenue: number;
  allFinal: boolean;
  activeShops: number;
  shopsAtTarget: number;
};
