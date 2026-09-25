import { calculateManagerBonus, MANAGER_PAYOUT_TABLE_VERSION } from "@/lib/manager-bonus";
import { calculateRepresentativeBonus, REPRESENTATIVE_PAYOUT_TABLE_VERSION } from "@/lib/sales-representative-bonus";
import { roundRepresentativeTargets } from "@/lib/representative-targets";
import { getPerformanceShopActuals, getShopMetrics, type BonusSnapshot, type PerformanceData, type Shop } from "@/lib/types";
import { calculateQuarterlyBonus, getQuarterlyMonthFromSnapshot, QUARTERLY_CALCULATION_VERSION, QUARTERLY_PAYOUT_TABLE_VERSION } from "@/lib/quarterly-bonus";
import type { QuarterlyBonusSnapshot } from "@/lib/types";

export function bonusSnapshotFromImport(shop: Shop, performance: PerformanceData, finalizedAt: string): BonusSnapshot {
  if (performance.reportType !== "completedMonth" || !performance.importId || performance.revenue === undefined || !performance.targets) {
    throw new Error("A completed monthly Excel report is required to create a payroll snapshot.");
  }
  const month = performance.date.slice(0, 7);
  const monthData = shop.monthlyData?.[month];
  const targets = performance.targets;
  const collection = performance.revenue;
  const metricSettings = performance.metricSettings ?? monthData?.metricSettings ?? shop.metricSettings;
  const metrics = getShopMetrics({ ...shop, metricSettings, metricOrder: performance.metricOrder ?? monthData?.metricOrder }, targets);
  const savedRepresentativeTargets = performance.representativeTargets ?? monthData?.representativeTargets;
  if (!savedRepresentativeTargets || performance.reps.some(rep => !savedRepresentativeTargets[rep.repId])) {
    throw new Error("The completed Excel report is missing representative targets.");
  }
  const representativeTargets = Object.fromEntries(Object.entries(savedRepresentativeTargets).map(([id, target]) => [id, roundRepresentativeTargets(target)]));
  const shopActuals = getPerformanceShopActuals([performance], metrics);
  const representativeActuals = Object.fromEntries(performance.reps.map(rep => [
    rep.repId,
    Object.fromEntries(metrics.map(metric => [metric, rep[metric] ?? 0])),
  ]));
  const manager = calculateManagerBonus(collection, shopActuals, targets, metrics, metricSettings);
  const representatives = performance.reps.map(rep => {
    const result = calculateRepresentativeBonus(
      collection, representativeActuals[rep.repId], representativeTargets[rep.repId], shopActuals, targets, metrics, metricSettings,
    );
    return { id: rep.repId, name: rep.repName ?? rep.repId, eligible: result.shopBonusEligible, result };
  });
  return {
    month,
    finalizedAt,
    sourceImportId: performance.importId,
    calculationVersion: "bonus-calculation-2026-02",
    payoutTableVersion: `${MANAGER_PAYOUT_TABLE_VERSION};${REPRESENTATIVE_PAYOUT_TABLE_VERSION}`,
    inputs: { collection, targets, representativeTargets, metricSettings, metricOrder: metrics, shopActuals, representativeActuals },
    manager,
    representatives,
  };
}

export function quarterlySnapshotFromMonths(quarter: string, monthly: BonusSnapshot[], finalizedAt: string, sourceImportId?: string): QuarterlyBonusSnapshot {
  const snapshot: QuarterlyBonusSnapshot = {
    quarter,
    finalizedAt,
    sourceImportId,
    calculationVersion: QUARTERLY_CALCULATION_VERSION,
    payoutTableVersion: QUARTERLY_PAYOUT_TABLE_VERSION,
    monthlySources: monthly.map(item => ({ month: item.month, finalizedAt: item.finalizedAt })),
    result: calculateQuarterlyBonus(quarter, monthly.map(getQuarterlyMonthFromSnapshot)),
  };
  return snapshot;
}
