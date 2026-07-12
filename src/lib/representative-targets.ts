import type { PerformanceMetric, Target } from "@/lib/types";

export function roundRepresentativeTargets(targets: Target): Target {
  return Object.fromEntries(
    Object.entries(targets).map(([metric, target]) => [metric, Math.round(target)])
  ) as Target;
}

export function getEqualRepresentativeTargets(
  targets: Target,
  metrics: readonly PerformanceMetric[],
  representativeCount: number
): Target {
  const divisor = Math.max(representativeCount, 1);
  return Object.fromEntries(
    metrics.map(metric => [metric, Math.round((targets[metric] ?? 0) / divisor)])
  ) as Target;
}
