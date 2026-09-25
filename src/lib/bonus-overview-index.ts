import "server-only";

import { z } from "zod";
import { adminDb } from "@/lib/firebase-admin";
import { bonusSnapshotSchema, performanceDataSchema } from "@/lib/persistence-schemas";
import { calculateManagerBonus } from "@/lib/manager-bonus";
import { calculateRepresentativeBonus } from "@/lib/sales-representative-bonus";
import { getMonthlyBonusForecast } from "@/lib/forecast";
import { getEqualRepresentativeTargets, roundRepresentativeTargets } from "@/lib/representative-targets";
import { getActivePerformanceData, getMonthlyRepresentatives, getPerformanceShopActuals, getShopMetrics, type BonusSnapshot, type PerformanceData, type PerformanceMetric, type Shop } from "@/lib/types";

const bonusRowSchema = z.object({
  id: z.string().min(1),
  shopId: z.string().min(1),
  shopName: z.string().min(1),
  person: z.string().min(1),
  role: z.enum(["manager", "representative"]),
  amount: z.number().finite().nonnegative(),
  forecastAmount: z.number().finite().nonnegative().nullable(),
  forecastAsOf: z.string().nullable(),
  finalized: z.boolean(),
}).strict();

export type BonusOverviewRow = z.infer<typeof bonusRowSchema>;

export const bonusOverviewDocumentSchema = z.object({
  schemaVersion: z.literal(2),
  updatedAt: z.string().datetime({ offset: true }),
  rows: z.array(bonusRowSchema).max(501),
}).strict();

export function bonusOverviewReference(month: string, shopId: string) {
  return adminDb.collection("bonusSummaries").doc(month).collection("shops").doc(shopId);
}

export async function loadBonusPerformance(shopId: string, month: string): Promise<PerformanceData[]> {
  const documents = await adminDb.collection("shops").doc(shopId).collection("performance")
    .where("date", ">=", `${month}-01`).where("date", "<=", `${month}-31`).orderBy("date", "asc").get();
  return documents.docs.flatMap(document => {
    const parsed = performanceDataSchema.safeParse({ id: document.id, ...document.data() });
    if (parsed.success) return [parsed.data as unknown as PerformanceData];
    console.error(`Ignoring invalid performance document ${document.ref.path}:`, parsed.error.flatten());
    return [];
  });
}

function calculateRows(shop: Shop, month: string, data: PerformanceData[], snapshot: BonusSnapshot | null): BonusOverviewRow[] {
  if (snapshot) return [
    { id: `${shop.id}:manager`, shopId: shop.id, shopName: shop.name, person: shop.name, role: "manager", amount: snapshot.manager.totalBonus, forecastAmount: snapshot.manager.totalBonus, forecastAsOf: null, finalized: true },
    ...snapshot.representatives.map(rep => ({ id: `${shop.id}:${rep.id}`, shopId: shop.id, shopName: shop.name, person: rep.name, role: "representative" as const, amount: rep.result.totalBonus, forecastAmount: rep.result.totalBonus, forecastAsOf: null, finalized: true })),
  ];

  const active = getActivePerformanceData(data.filter(entry => entry.date.startsWith(month)));
  const latestImport = active.find(entry => entry.importId);
  const monthData = shop.monthlyData?.[month];
  const targets = latestImport?.targets ?? monthData?.targets ?? shop.monthlyTargets;
  const collection = latestImport?.revenue ?? monthData?.collection ?? shop.revenue;
  if ((!active.length && !monthData) || !targets || collection === undefined) return [];

  const metricSettings = latestImport?.metricSettings ?? monthData?.metricSettings ?? shop.metricSettings;
  const metrics = getShopMetrics({ ...shop, metricOrder: latestImport?.metricOrder ?? monthData?.metricOrder ?? shop.metricOrder, metricSettings }, targets);
  const shopActuals = getPerformanceShopActuals(active, metrics);
  const representatives = latestImport
    ? latestImport.reps.map(rep => ({ id: rep.repId, name: rep.repName ?? rep.repId }))
    : getMonthlyRepresentatives(shop, month);
  const savedTargets = latestImport?.representativeTargets ?? monthData?.representativeTargets;
  const forecast = getMonthlyBonusForecast(shop, month, data, shop.monthlyTargets);
  const forecastByRep = new Map(forecast?.representatives.map(rep => [rep.id, rep.result.totalBonus]));
  const forecastAsOf = forecast?.asOfDate.toISOString().slice(0, 10) ?? null;
  const equalTargets = getEqualRepresentativeTargets(targets, metrics, representatives.length);
  const actualsByRepresentative = new Map<string, Record<PerformanceMetric, number>>();
  active.forEach(entry => entry.reps.forEach(rep => {
    const actuals = actualsByRepresentative.get(rep.repId) ?? {} as Record<PerformanceMetric, number>;
    metrics.forEach(metric => { actuals[metric] = (actuals[metric] ?? 0) + (rep[metric] ?? 0); });
    actualsByRepresentative.set(rep.repId, actuals);
  }));

  return [
    { id: `${shop.id}:manager`, shopId: shop.id, shopName: shop.name, person: shop.name, role: "manager", amount: calculateManagerBonus(collection, shopActuals, targets, metrics, metricSettings).totalBonus, forecastAmount: forecast?.manager.totalBonus ?? null, forecastAsOf, finalized: false },
    ...representatives.map(rep => ({
      id: `${shop.id}:${rep.id}`, shopId: shop.id, shopName: shop.name, person: rep.name, role: "representative" as const,
      amount: calculateRepresentativeBonus(collection, actualsByRepresentative.get(rep.id) ?? {}, savedTargets?.[rep.id] ? roundRepresentativeTargets(savedTargets[rep.id]) : equalTargets, shopActuals, targets, metrics, metricSettings).totalBonus,
      forecastAmount: forecastByRep.get(rep.id) ?? null,
      forecastAsOf,
      finalized: false,
    })),
  ];
}

export async function syncBonusOverviewProjection(shop: Shop | null, month: string, performance: PerformanceData[]) {
  if (!shop) return;
  const reference = bonusOverviewReference(month, shop.id);
  const snapshot = await adminDb.collection("shops").doc(shop.id).collection("bonusSnapshots").doc(month).get();
  const parsed = snapshot.exists ? bonusSnapshotSchema.safeParse(snapshot.data()) : null;
  if (parsed && !parsed.success) console.error(`Ignoring invalid bonus snapshot ${snapshot.ref.path}:`, parsed.error.flatten());
  const rows = calculateRows(shop, month, performance, parsed?.success ? parsed.data as BonusSnapshot : null);
  const document = bonusOverviewDocumentSchema.parse({ schemaVersion: 2, updatedAt: new Date().toISOString(), rows });
  await reference.set(document);
}
