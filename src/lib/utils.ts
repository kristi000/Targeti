
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { type Target, getMetricOrder, type PerformanceMetric, type MetricSettings } from "./types";
import { getMetricWeight } from "./data";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function calculateTotalAchievement(
  currentTotals: Record<string, number>,
  targets: Target | undefined,
  metricSettings?: MetricSettings,
): number {
  if (!targets) return 0;

  const metrics = getMetricOrder(undefined, Object.keys(targets) as PerformanceMetric[]);
  const { weightedAchievement, totalWeight } = metrics.reduce((result, metric: PerformanceMetric) => {
    const value = currentTotals[metric] ?? 0;
    const target = targets[metric];
    if (!(target > 0)) return result;

    const weight = Math.max(getMetricWeight(metric, metricSettings), 0);
    if (weight === 0) return result;

    const achievement = (value / target) * 100;
    const cappedAchievement = Math.min(achievement, 120);
    result.weightedAchievement += cappedAchievement * weight;
    result.totalWeight += weight;
    return result;
  }, { weightedAchievement: 0, totalWeight: 0 });

  if (totalWeight === 0) return 0;
  return Math.min(weightedAchievement / totalWeight, 120);
}
