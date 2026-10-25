"use server";

import { z } from "zod";

import { fetchDashboardPage, fetchDashboardPeriods } from "@/app/dashboard-actions";
import { getCurrentActor } from "@/lib/access";
import { createInsightsPerformance, getInsightsPeriod, insightsInputSchema, type InsightsMonthlySource, type InsightsPerformance, type InsightsView } from "@/lib/insights";
import { shopIdSchema, supervisorIdSchema } from "@/lib/persistence-schemas";
import { measureServerOperation } from "@/lib/server/performance";

const countSchema = z.number().int().nonnegative();
const nameSchema = z.string().min(1).max(120);
const monthlyDashboardSchema = z.object({
  rows: z.array(z.object({
    shop: z.object({ id: shopIdSchema, name: nameSchema, supervisorId: supervisorIdSchema.optional() }),
    totalAchievement: z.number().finite(), revenue: z.number().finite(), isFinal: z.boolean(), hasData: z.boolean(),
  })),
  summary: z.object({
    average: z.number().finite(), forecast: z.number().finite().nullable(), revenue: z.number().finite(),
    allFinal: z.boolean(), activeShops: countSchema, shopsAtTarget: countSchema,
  }),
  supervisorRows: z.array(z.object({ id: supervisorIdSchema, name: nameSchema })),
  representativeRows: z.array(z.object({
    id: shopIdSchema, name: nameSchema, shopId: shopIdSchema, shopName: nameSchema, achievement: z.number().finite(),
  })),
});

export async function fetchInsightsPerformance(input: { month: string; view: InsightsView }): Promise<InsightsPerformance> {
  return measureServerOperation("dashboard.insights-period", async () => {
    const actor = await getCurrentActor();
    const value = insightsInputSchema.parse(input);
    const period = getInsightsPeriod(value.month, value.view);
    if (actor.role !== "admin" && actor.shopIds.length === 0) return createInsightsPerformance(period, [], []);
    const periods = await fetchDashboardPeriods();
    const available = new Set(periods.map(item => item.month));
    const availableMonths = period.months.filter(month => available.has(month));
    const sources: InsightsMonthlySource[] = [];
    // At most twelve months, with three existing authorized summary reads in flight.
    for (let start = 0; start < availableMonths.length; start += 3) {
      const batch = await Promise.all(availableMonths.slice(start, start + 3).map(async month => {
        const page = monthlyDashboardSchema.parse(await fetchDashboardPage({ month, sortBy: "shop", sortDirection: "asc" }));
        const supervisorNames = new Map(page.supervisorRows.map(row => [row.id, row.name]));
        return {
          month,
          summary: page.summary,
          shops: page.rows.map(row => ({
            id: row.shop.id, name: row.shop.name,
            supervisorId: row.shop.supervisorId ?? null,
            supervisorName: row.shop.supervisorId ? supervisorNames.get(row.shop.supervisorId) ?? row.shop.supervisorId : null,
            achievement: row.totalAchievement, revenue: row.revenue, isFinal: row.isFinal, hasData: row.hasData,
          })),
          representatives: page.representativeRows,
        } satisfies InsightsMonthlySource;
      }));
      sources.push(...batch);
    }
    return createInsightsPerformance(period, availableMonths, sources);
  });
}
