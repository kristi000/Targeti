import { z } from "zod";

import type { DashboardSummary } from "@/lib/dashboard-types";
import { attendanceMonthSchema } from "@/lib/persistence-schemas";

export const insightsViewSchema = z.enum(["month", "quarter", "year"]);
export const insightsInputSchema = z.object({ month: attendanceMonthSchema, view: insightsViewSchema }).strict();
export type InsightsView = z.infer<typeof insightsViewSchema>;

export type InsightsPeriod = {
  view: InsightsView;
  month: string;
  key: string;
  months: string[];
};

export type InsightsMonthValue = { month: string; achievement: number | null; isFinal: boolean };
export type InsightsPerformanceRow = {
  id: string;
  name: string;
  achievement: number | null;
  months: InsightsMonthValue[];
  reportingMonths: number;
  finalMonths: number;
  rank: number | null;
};
export type InsightsShopRow = InsightsPerformanceRow & {
  shopId: string;
  supervisorNames: string[];
  revenue: number;
};
export type InsightsSupervisorRow = InsightsPerformanceRow & { shopCount: number; revenue: number };
export type InsightsRepresentativeRow = InsightsPerformanceRow & { representativeId: string; shopId: string; shopName: string };
export type InsightsPerformance = {
  period: InsightsPeriod;
  summary: DashboardSummary;
  availableMonths: string[];
  reportingMonths: number;
  finalMonths: number;
  shopRows: InsightsShopRow[];
  supervisorRows: InsightsSupervisorRow[];
  representativeRows: InsightsRepresentativeRow[];
};

export type InsightsMonthlySource = {
  month: string;
  summary: DashboardSummary;
  shops: Array<{
    id: string;
    name: string;
    supervisorId: string | null;
    supervisorName: string | null;
    achievement: number;
    revenue: number;
    isFinal: boolean;
    hasData: boolean;
  }>;
  representatives: Array<{ id: string; name: string; shopId: string; shopName: string; achievement: number }>;
};

export function parseInsightsView(value: string | null | undefined): InsightsView {
  return insightsViewSchema.catch("month").parse(value);
}

export function getInsightsPeriod(month: string, view: InsightsView): InsightsPeriod {
  const input = insightsInputSchema.parse({ month, view });
  const year = input.month.slice(0, 4);
  const monthNumber = Number(input.month.slice(5));
  const quarter = Math.ceil(monthNumber / 3);
  const first = view === "year" ? 1 : view === "quarter" ? (quarter - 1) * 3 + 1 : monthNumber;
  const count = view === "year" ? 12 : view === "quarter" ? 3 : 1;
  return {
    ...input,
    key: view === "year" ? year : view === "quarter" ? `${year}-Q${quarter}` : month,
    months: Array.from({ length: count }, (_, index) => `${year}-${String(first + index).padStart(2, "0")}`),
  };
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function rowValues(period: InsightsPeriod, values: Map<string, { achievement: number; isFinal: boolean }>) {
  const months = period.months.map(month => {
    const value = values.get(month);
    return { month, achievement: value?.achievement ?? null, isFinal: value?.isFinal ?? false };
  });
  const reporting = months.filter(value => value.achievement !== null);
  return {
    achievement: average(reporting.map(value => value.achievement!)),
    months,
    reportingMonths: reporting.length,
    finalMonths: reporting.filter(value => value.isFinal).length,
    rank: null,
  };
}

function rankRows<Row extends InsightsPerformanceRow>(rows: Row[]): Row[] {
  return rows.sort((left, right) => (right.achievement ?? -1) - (left.achievement ?? -1)
    || left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
    .map((row, index) => ({ ...row, rank: row.achievement === null ? null : index + 1 }));
}

export function createInsightsPerformance(period: InsightsPeriod, availableMonths: string[], sources: InsightsMonthlySource[]): InsightsPerformance {
  const shops = new Map<string, { name: string; values: Map<string, { achievement: number; isFinal: boolean }>; supervisors: Set<string>; revenue: number }>();
  const supervisors = new Map<string, { name: string; values: Map<string, { achievement: number; isFinal: boolean }>; shopIds: Set<string>; revenue: number }>();
  const representatives = new Map<string, { name: string; representativeId: string; shopId: string; shopName: string; values: Map<string, { achievement: number; isFinal: boolean }> }>();
  const monthValues = new Map<string, { achievement: number; isFinal: boolean }>();

  for (const source of [...sources].sort((left, right) => left.month.localeCompare(right.month))) {
    const reportingShops = source.shops.filter(shop => shop.hasData);
    if (reportingShops.length) monthValues.set(source.month, {
      achievement: average(reportingShops.map(shop => shop.achievement))!,
      isFinal: reportingShops.every(shop => shop.isFinal),
    });
    const monthlySupervisors = new Map<string, typeof reportingShops>();
    for (const shop of source.shops) {
      const current = shops.get(shop.id) ?? { name: shop.name, values: new Map(), supervisors: new Set<string>(), revenue: 0 };
      current.name = shop.name;
      if (shop.supervisorName) current.supervisors.add(shop.supervisorName);
      if (shop.hasData) {
        current.values.set(source.month, { achievement: shop.achievement, isFinal: shop.isFinal });
        current.revenue += shop.revenue;
      }
      shops.set(shop.id, current);
      if (!shop.supervisorId || !shop.hasData) continue;
      const group = monthlySupervisors.get(shop.supervisorId) ?? [];
      group.push(shop);
      monthlySupervisors.set(shop.supervisorId, group);
    }
    for (const [id, group] of monthlySupervisors) {
      const name = group.at(-1)?.supervisorName ?? id;
      const current = supervisors.get(id) ?? { name, values: new Map(), shopIds: new Set<string>(), revenue: 0 };
      current.name = name;
      current.values.set(source.month, { achievement: average(group.map(shop => shop.achievement))!, isFinal: group.every(shop => shop.isFinal) });
      group.forEach(shop => current.shopIds.add(shop.id));
      current.revenue += group.reduce((sum, shop) => sum + shop.revenue, 0);
      supervisors.set(id, current);
    }
    const reportingById = new Map(reportingShops.map(shop => [shop.id, shop]));
    for (const representative of source.representatives) {
      const shop = reportingById.get(representative.shopId);
      if (!shop) continue;
      // Representative IDs belong to a shop roster; names are not safe cross-shop identities.
      const id = JSON.stringify([representative.shopId, representative.id]);
      const current = representatives.get(id) ?? { name: representative.name, representativeId: representative.id, shopId: representative.shopId, shopName: representative.shopName, values: new Map() };
      current.name = representative.name;
      current.shopName = representative.shopName;
      current.values.set(source.month, { achievement: representative.achievement, isFinal: shop.isFinal });
      representatives.set(id, current);
    }
  }

  const shopRows = rankRows([...shops].map(([id, value]) => ({
    id, shopId: id, name: value.name, supervisorNames: [...value.supervisors], revenue: value.revenue,
    ...rowValues(period, value.values),
  })));
  const supervisorRows = rankRows([...supervisors].map(([id, value]) => ({
    id, name: value.name, shopCount: value.shopIds.size, revenue: value.revenue, ...rowValues(period, value.values),
  })));
  const representativeRows = rankRows([...representatives].map(([id, value]) => ({
    id, name: value.name, representativeId: value.representativeId, shopId: value.shopId, shopName: value.shopName,
    ...rowValues(period, value.values),
  })));
  const reportingShops = shopRows.filter(row => row.achievement !== null);
  const overall = rowValues(period, monthValues);
  const monthlySummary = period.view === "month" ? sources[0]?.summary : undefined;
  return {
    period,
    availableMonths,
    reportingMonths: overall.reportingMonths,
    finalMonths: overall.finalMonths,
    summary: {
      average: overall.achievement ?? 0,
      forecast: monthlySummary?.forecast ?? null,
      revenue: reportingShops.reduce((sum, row) => sum + row.revenue, 0),
      allFinal: overall.reportingMonths === period.months.length && overall.finalMonths === overall.reportingMonths,
      activeShops: reportingShops.length,
      shopsAtTarget: reportingShops.filter(row => row.achievement! >= 100).length,
    },
    shopRows,
    supervisorRows,
    representativeRows,
  };
}
