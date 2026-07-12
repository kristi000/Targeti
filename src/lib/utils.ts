
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
  const weightedTotal = metrics.reduce((total, metric: PerformanceMetric) => {
    const value = currentTotals[metric] ?? 0;
    const target = targets[metric];
    const achievement = target > 0 ? (value / target) * 100 : 0;
    const cappedAchievement = Math.min(achievement, 120);
    return total + cappedAchievement * getMetricWeight(metric, metricSettings);
  }, 0);

  return Math.min(weightedTotal, 120);
}
