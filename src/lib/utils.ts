
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { type Target, performanceMetrics, type PerformanceMetric } from "./types";
import { METRIC_WEIGHTS } from "./data";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function calculateTotalAchievement(
  currentTotals: Record<string, number>,
  targets: Target | undefined
): number {
  if (!targets) return 0;

  const weightedTotal = performanceMetrics.reduce((total, metric: PerformanceMetric) => {
    const value = currentTotals[metric] ?? 0;
    const target = targets[metric];
    const achievement = target > 0 ? (value / target) * 100 : 0;
    const cappedAchievement = Math.min(achievement, 120);
    return total + cappedAchievement * METRIC_WEIGHTS[metric];
  }, 0);

  return Math.min(weightedTotal, 120);
}
