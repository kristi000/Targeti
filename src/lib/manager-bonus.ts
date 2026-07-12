import { getMetricWeight } from "@/lib/data";
import type { MetricSettings, PerformanceMetric, Target } from "@/lib/types";

const BASE_BONUS_GROUPS = [
  { name: "Group 1", minimumCollection: 0, baseBonus: 32_000 },
  { name: "Group 2", minimumCollection: 3_000_000, baseBonus: 37_000 },
  { name: "Group 3", minimumCollection: 4_500_000, baseBonus: 42_000 },
  { name: "Group 4", minimumCollection: 6_000_000, baseBonus: 46_000 },
  { name: "Group 5", minimumCollection: 7_500_000, baseBonus: 48_000 },
] as const;

const PAYOUT_PERCENTAGES = [
  30, 33.5, 37, 40.5, 44, 47.5, 51, 54.5, 58, 61.5,
  65, 68.5, 72, 75.5, 79, 82.5, 86, 89.5, 93, 96.5,
  100, 101, 103, 104, 105, 106, 108, 109, 110, 111,
  113, 114, 115, 116, 118, 119, 120, 121, 123, 124, 125,
] as const;

export const MANAGER_PAYOUT_TABLE_VERSION = "manager-2026-01";

export type ManagerBonusCategory = {
  metric: PerformanceMetric;
  achievementPercentage: number;
  payoutPercentage: number;
  weight: number;
  bonus: number;
};

export function getManagerPayoutPercentage(achievementPercentage: number): number {
  if (!Number.isFinite(achievementPercentage) || achievementPercentage < 80) return 0;
  const wholeAchievement = Math.min(Math.floor(achievementPercentage), 120);
  return PAYOUT_PERCENTAGES[wholeAchievement - 80];
}

export function calculateManagerBonus(
  monthlyCollection: number,
  actuals: Record<string, number>,
  targets: Target,
  metrics: readonly PerformanceMetric[],
  metricSettings?: MetricSettings,
) {
  const normalizedCollection = Number.isFinite(monthlyCollection) ? Math.max(monthlyCollection, 0) : 0;
  const group = [...BASE_BONUS_GROUPS].reverse()
    .find(candidate => normalizedCollection >= candidate.minimumCollection) ?? BASE_BONUS_GROUPS[0];
  const categories: ManagerBonusCategory[] = metrics.map(metric => {
    const target = targets[metric] ?? 0;
    const rawAchievement = target > 0 ? ((actuals[metric] ?? 0) / target) * 100 : 0;
    const achievementPercentage = Math.min(Math.max(rawAchievement, 0), 120);
    const payoutPercentage = getManagerPayoutPercentage(rawAchievement);
    const weight = getMetricWeight(metric, metricSettings);
    return { metric, achievementPercentage, payoutPercentage, weight, bonus: group.baseBonus * weight * (payoutPercentage / 100) };
  });
  return { groupName: group.name, baseBonus: group.baseBonus, totalBonus: categories.reduce((sum, item) => sum + item.bonus, 0), categories };
}
