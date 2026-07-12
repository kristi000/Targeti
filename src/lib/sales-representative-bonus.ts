import { getMetricWeight } from "@/lib/data";
import { calculateTotalAchievement } from "@/lib/utils";
import type { MetricSettings, PerformanceMetric, Target } from "@/lib/types";

const BASE_BONUS_GROUPS = [
  { name: "Group 1", minimumCollection: 0, baseBonus: 14_000 },
  { name: "Group 2", minimumCollection: 3_000_000, baseBonus: 21_000 },
  { name: "Group 3", minimumCollection: 4_500_000, baseBonus: 29_000 },
  { name: "Group 4", minimumCollection: 6_000_000, baseBonus: 31_000 },
  { name: "Group 5", minimumCollection: 7_500_000, baseBonus: 35_000 },
] as const;

const PAYOUT_PERCENTAGES = [
  15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
  26, 28, 30, 32, 34, 36, 38, 40, 42, 44,
  48, 52, 56, 60, 64, 70, 76, 82, 88, 94,
  100, 101, 103, 104, 105, 106, 108, 109, 110, 111,
  113, 114, 115, 116, 118, 119, 120, 121, 123, 124, 125,
] as const;

export const REPRESENTATIVE_PAYOUT_TABLE_VERSION = "representative-2026-01";

export function getRepresentativePayoutPercentage(achievement: number): number {
  if (!Number.isFinite(achievement) || achievement < 70) return 0;
  return PAYOUT_PERCENTAGES[Math.min(Math.floor(achievement), 120) - 70];
}

export function calculateRepresentativeBonus(
  monthlyCollection: number,
  individualActuals: Record<string, number>,
  individualTargets: Target,
  shopActuals: Record<string, number>,
  shopTargets: Target,
  metrics: readonly PerformanceMetric[],
  metricSettings?: MetricSettings,
) {
  const collection = Number.isFinite(monthlyCollection) ? Math.max(monthlyCollection, 0) : 0;
  const group = [...BASE_BONUS_GROUPS].reverse().find(item => collection >= item.minimumCollection) ?? BASE_BONUS_GROUPS[0];
  const individualPerformance = calculateTotalAchievement(individualActuals, individualTargets, metricSettings);
  const shopBonusEligible = individualPerformance >= 50;
  const categories = metrics.map(metric => {
    const individualTarget = individualTargets[metric] ?? 0;
    const shopTarget = shopTargets[metric] ?? 0;
    const individualAchievement = individualTarget > 0 ? ((individualActuals[metric] ?? 0) / individualTarget) * 100 : 0;
    const shopAchievement = shopTarget > 0 ? ((shopActuals[metric] ?? 0) / shopTarget) * 100 : 0;
    const individualPayout = getRepresentativePayoutPercentage(individualAchievement);
    const shopPayout = getRepresentativePayoutPercentage(shopAchievement);
    const weight = getMetricWeight(metric, metricSettings);
    const individualBonus = 0.6 * weight * (individualPayout / 100) * group.baseBonus;
    const shopBonus = shopBonusEligible ? 0.4 * weight * (shopPayout / 100) * group.baseBonus : 0;
    return { metric, weight, individualAchievement: Math.min(Math.max(individualAchievement, 0), 120), shopAchievement: Math.min(Math.max(shopAchievement, 0), 120), individualPayout, shopPayout, individualBonus, shopBonus, totalBonus: individualBonus + shopBonus };
  });
  return { groupName: group.name, baseBonus: group.baseBonus, individualPerformance, shopBonusEligible, categories, totalBonus: categories.reduce((sum, item) => sum + item.totalBonus, 0) };
}
