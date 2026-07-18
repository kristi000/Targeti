import { isAfter, isSameMonth, isValid, parseISO } from "date-fns";
import { calculateTotalAchievement } from "@/lib/utils";
import type { MetricSettings, PerformanceData, PerformanceMetric, Target } from "@/lib/types";

type ForecastReport = Pick<PerformanceData, "date" | "asOfDate" | "importedAt">;

export function getForecastDate(report: ForecastReport, now = new Date()) {
  const reportedDate = parseISO(report.asOfDate ?? report.date);
  if (!isValid(reportedDate)) return now;

  const importedDate = report.importedAt ? parseISO(report.importedAt) : undefined;
  const hasMonthStartPlaceholder = reportedDate.getDate() === 1
    && importedDate
    && isValid(importedDate)
    && isSameMonth(reportedDate, importedDate)
    && importedDate.getDate() > 1;

  if (!hasMonthStartPlaceholder) return reportedDate;
  return isAfter(importedDate, now) ? now : importedDate;
}

export function calculateForecastAchievement(
  actuals: Record<string, number>,
  targets: Target,
  metrics: readonly PerformanceMetric[],
  asOfDate: Date,
  metricSettings?: MetricSettings,
) {
  const elapsedDays = Math.max(asOfDate.getDate(), 1);
  const daysInMonth = new Date(asOfDate.getFullYear(), asOfDate.getMonth() + 1, 0).getDate();
  const projectedActuals = Object.fromEntries(
    metrics.map(metric => [metric, ((actuals[metric] ?? 0) / elapsedDays) * daysInMonth]),
  );

  return calculateTotalAchievement(projectedActuals, targets, metricSettings);
}
