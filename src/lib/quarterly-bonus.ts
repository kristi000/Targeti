import { getManagerBonusGroup } from "@/lib/manager-bonus";
import { getRepresentativeBonusGroup } from "@/lib/sales-representative-bonus";
import { getBonusForecastDate, projectMetrics, projectMonthlyCollection } from "@/lib/forecast";
import { getEqualRepresentativeTargets, roundRepresentativeTargets } from "@/lib/representative-targets";
import { getActivePerformanceData, getMonthlyRepresentatives, getPerformanceShopActuals, getShopMetrics, type BonusSnapshot, type PerformanceData, type Shop, type Target } from "@/lib/types";
import { calculateTotalAchievement } from "@/lib/utils";

export const QUARTERLY_CALCULATION_VERSION = "quarterly-bonus-2026-01";
export const QUARTERLY_PAYOUT_TABLE_VERSION = "quarterly-80-120-2026-01";

export function getQuarterMonths(quarter: string): string[] {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!match) throw new Error("Invalid quarter.");
  const start = (Number(match[2]) - 1) * 3 + 1;
  return [0, 1, 2].map(offset => `${match[1]}-${String(start + offset).padStart(2, "0")}`);
}

export function getQuarterlyPayoutRate(achievement: number): number {
  if (!Number.isFinite(achievement)) return 0;
  const rounded = Math.min(Math.round(achievement), 120);
  if (rounded < 80) return 0;
  return rounded <= 100 ? 20 + (rounded - 80) * 2 : 60 + (rounded - 100);
}

export type QuarterlyBonusMonth = {
  month: string;
  collection: number;
  shopPerformance: number;
  representatives: Array<{ id: string; name: string; performance: number }>;
};

export function getQuarterlyMonthFromSnapshot(snapshot: BonusSnapshot): QuarterlyBonusMonth {
  return {
    month: snapshot.month,
    collection: snapshot.inputs.collection,
    shopPerformance: calculateTotalAchievement(snapshot.inputs.shopActuals, snapshot.inputs.targets, snapshot.inputs.metricSettings),
    representatives: snapshot.representatives.flatMap(rep => {
      const targets = snapshot.inputs.representativeTargets[rep.id];
      if (!targets) return [];
      return [{
        id: rep.id,
        name: rep.name,
        performance: calculateTotalAchievement(snapshot.inputs.representativeActuals[rep.id] ?? {}, targets, snapshot.inputs.metricSettings),
      }];
    }),
  };
}

export function getQuarterlyForecastMonth(shop: Shop, month: string, data: PerformanceData[], legacyTargets?: Target, now = new Date()) {
  const performanceData = getActivePerformanceData(data).filter(entry => entry.date.startsWith(month));
  const latestImport = performanceData.find(entry => entry.importId);
  const asOfDate = getBonusForecastDate(month, performanceData, latestImport, now);
  const monthData = shop.monthlyData?.[month];
  const collection = latestImport?.revenue ?? monthData?.collection;
  const targets = latestImport?.targets ?? monthData?.targets ?? legacyTargets;
  if (!asOfDate || collection === undefined || !targets || performanceData.length === 0) return null;
  const metricSettings = latestImport?.metricSettings ?? monthData?.metricSettings ?? shop.metricSettings;
  const metricOrder = latestImport?.metricOrder ?? monthData?.metricOrder ?? shop.metricOrder;
  const metrics = getShopMetrics({ ...shop, metricSettings, metricOrder }, targets);
  const shopActuals = getPerformanceShopActuals(performanceData, metrics);
  const repActuals = performanceData.reduce((totals, day) => {
    day.reps.forEach(rep => metrics.forEach(metric => {
      totals[rep.repId] ??= {};
      totals[rep.repId][metric] = (totals[rep.repId][metric] ?? 0) + (rep[metric] ?? 0);
    }));
    return totals;
  }, {} as Record<string, Record<string, number>>);
  const reps = latestImport
    ? latestImport.reps.map(rep => ({ id: rep.repId, name: rep.repName ?? rep.repId }))
    : getMonthlyRepresentatives(shop, month);
  const savedTargets = latestImport?.representativeTargets ?? monthData?.representativeTargets;
  const representatives = reps.flatMap(rep => {
    const repTargets = savedTargets
      ? savedTargets[rep.id] && roundRepresentativeTargets(savedTargets[rep.id])
      : getEqualRepresentativeTargets(targets, metrics, reps.length);
    if (!repTargets) return [];
    return [{
      id: rep.id,
      name: rep.name,
      performance: calculateTotalAchievement(projectMetrics(repActuals[rep.id] ?? {}, metrics, asOfDate), repTargets, metricSettings),
    }];
  });
  const input: QuarterlyBonusMonth = {
    month,
    collection: projectMonthlyCollection(collection, asOfDate),
    shopPerformance: calculateTotalAchievement(projectMetrics(shopActuals, metrics, asOfDate), targets, metricSettings),
    representatives,
  };
  return { input, asOfDate };
}

export function calculateQuarterlyBonus(quarter: string, inputs: QuarterlyBonusMonth[]) {
  const months = getQuarterMonths(quarter);
  const byMonth = new Map(inputs.map(input => [input.month, input]));
  if (months.some(month => !byMonth.has(month))) throw new Error("All three monthly results are required.");
  const ordered = months.map(month => byMonth.get(month)!);
  const shopMonths = ordered.map(input => ({
    month: input.month,
    performance: input.shopPerformance,
    collection: input.collection,
  }));
  const shopAverage = shopMonths.reduce((sum, item) => sum + item.performance, 0) / 3;
  const averageCollection = shopMonths.reduce((sum, item) => sum + item.collection, 0) / 3;
  const managerGroup = getManagerBonusGroup(averageCollection);
  const representativeGroup = getRepresentativeBonusGroup(averageCollection);
  const shopRate = getQuarterlyPayoutRate(shopAverage);
  const managerEligible = shopRate > 0;
  const repIds = new Set(ordered.flatMap(input => input.representatives.map(rep => rep.id)));
  const representatives = [...repIds].map(id => {
    const monthly = ordered.map(input => {
      const rep = input.representatives.find(item => item.id === id);
      return {
        month: input.month,
        active: Boolean(rep),
        performance: rep?.performance ?? null,
      };
    });
    const activeAllMonths = monthly.every(item => item.active);
    const individualAverage = activeAllMonths
      ? monthly.reduce((sum, item) => sum + (item.performance ?? 0), 0) / 3
      : null;
    const individualRate = individualAverage === null ? 0 : getQuarterlyPayoutRate(individualAverage);
    const eligible = activeAllMonths && individualRate > 0 && shopRate > 0;
    return {
      id,
      name: ordered.flatMap(input => input.representatives).find(rep => rep.id === id)?.name ?? id,
      monthly,
      activeAllMonths,
      individualAverage,
      eligible,
      groupName: representativeGroup.name,
      baseBonus: representativeGroup.baseBonus,
      individualRate,
      shopRate,
      totalBonus: eligible ? representativeGroup.baseBonus * (0.6 * individualRate + 0.4 * shopRate) / 100 : 0,
    };
  });
  const manager = {
    eligible: managerEligible,
    groupName: managerGroup.name,
    baseBonus: managerGroup.baseBonus,
    shopRate,
    totalBonus: managerEligible ? managerGroup.baseBonus * shopRate / 100 : 0,
  };
  return { quarter, months, shopMonths, shopAverage, averageCollection, manager, representatives,
    totalBonus: manager.totalBonus + representatives.reduce((sum, rep) => sum + rep.totalBonus, 0) };
}
