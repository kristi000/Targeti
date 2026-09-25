import { isAfter, isSameMonth, isValid, parseISO } from "date-fns";
import { calculateTotalAchievement } from "@/lib/utils";
import { calculateManagerBonus } from "@/lib/manager-bonus";
import { calculateRepresentativeBonus } from "@/lib/sales-representative-bonus";
import { getEqualRepresentativeTargets, roundRepresentativeTargets } from "@/lib/representative-targets";
import { getActivePerformanceData, getMonthlyRepresentatives, getPerformanceShopActuals, getShopMetrics, type MetricSettings, type PerformanceData, type PerformanceMetric, type Shop, type Target } from "@/lib/types";

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

export function getBonusForecastDate(month: string, performanceData: PerformanceData[], latestImport?: PerformanceData, now = new Date()): Date | null {
  if (latestImport?.reportType === "completedMonth") return null;
  const currentMonth = isSameMonth(parseISO(`${month}-01`), now);
  if (latestImport?.reportType !== "midMonth" && !(currentMonth && performanceData.length >= 2)) return null;
  return latestImport?.reportType === "midMonth" ? getForecastDate(latestImport, now) : now;
}

export function projectMonthlyCollection(collection: number, asOfDate: Date): number {
  const daysInMonth = new Date(asOfDate.getFullYear(), asOfDate.getMonth() + 1, 0).getDate();
  return collection / Math.max(asOfDate.getDate(), 1) * daysInMonth;
}

export function calculateForecastAchievement(
  actuals: Record<string, number>,
  targets: Target,
  metrics: readonly PerformanceMetric[],
  asOfDate: Date,
  metricSettings?: MetricSettings,
) {
  return calculateTotalAchievement(projectMetrics(actuals, metrics, asOfDate), targets, metricSettings);
}

export function projectMetrics(
  actuals: Record<string, number>,
  metrics: readonly PerformanceMetric[],
  asOfDate: Date,
): Record<PerformanceMetric, number> {
  const elapsedDays = Math.max(asOfDate.getDate(), 1);
  const daysInMonth = new Date(asOfDate.getFullYear(), asOfDate.getMonth() + 1, 0).getDate();
  return Object.fromEntries(
    metrics.map(metric => [metric, ((actuals[metric] ?? 0) / elapsedDays) * daysInMonth]),
  ) as Record<PerformanceMetric, number>;
}

export function getMonthlyBonusForecast(shop: Shop, month: string, allData: PerformanceData[], legacyTargets?: Target, now = new Date()) {
  const performanceData = getActivePerformanceData(allData).filter(entry => entry.date.startsWith(month));
  const latestImport = performanceData.find(entry => entry.importId);
  const asOfDate = getBonusForecastDate(month, performanceData, latestImport, now);
  const monthData = shop.monthlyData?.[month];
  const collection = latestImport?.revenue ?? monthData?.collection;
  const targets = latestImport?.targets ?? monthData?.targets ?? legacyTargets;
  if (!asOfDate || collection === undefined || !targets) return null;
  const metricSettings = latestImport?.metricSettings ?? monthData?.metricSettings ?? shop.metricSettings;
  const metricOrder = latestImport?.metricOrder ?? monthData?.metricOrder ?? shop.metricOrder;
  const metrics = getShopMetrics({ ...shop, metricOrder, metricSettings }, targets);
  const shopActuals = getPerformanceShopActuals(performanceData, metrics);
  const representativeActuals = performanceData.reduce((totals, day) => {
    day.reps.forEach(rep => metrics.forEach(metric => {
      totals[rep.repId] ??= {};
      totals[rep.repId][metric] = (totals[rep.repId][metric] ?? 0) + (rep[metric] ?? 0);
    }));
    return totals;
  }, {} as Record<string, Record<string, number>>);
  const representatives = latestImport
    ? latestImport.reps.map(rep => ({ id: rep.repId, name: rep.repName ?? rep.repId }))
    : getMonthlyRepresentatives(shop, month);
  const savedTargets = latestImport?.representativeTargets ?? monthData?.representativeTargets;
  const individualTargets = savedTargets
    ? Object.fromEntries(Object.entries(savedTargets).map(([id, value]) => [id, roundRepresentativeTargets(value)]))
    : Object.fromEntries(representatives.map(rep => [rep.id, getEqualRepresentativeTargets(targets, metrics, representatives.length)]));
  const projectedCollection = projectMonthlyCollection(collection, asOfDate);
  const projectedShop = projectMetrics(shopActuals, metrics, asOfDate);
  return {
    asOfDate,
    manager: calculateManagerBonus(projectedCollection, projectedShop, targets, metrics, metricSettings),
    representatives: representatives.map(rep => ({
      id: rep.id,
      name: rep.name,
      result: calculateRepresentativeBonus(projectedCollection, projectMetrics(representativeActuals[rep.id] ?? {}, metrics, asOfDate), individualTargets[rep.id] ?? getEqualRepresentativeTargets(targets, metrics, representatives.length), projectedShop, targets, metrics, metricSettings),
    })),
  };
}
