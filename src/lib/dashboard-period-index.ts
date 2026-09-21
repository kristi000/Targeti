import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { adminDb } from "@/lib/firebase-admin";
import { isoDateSchema, monthSchema, shopIdSchema } from "@/lib/persistence-schemas";

const MAX_INDEX_BYTES = 750_000;
const importSchema = z.object({
  id: shopIdSchema,
  month: monthSchema,
  createdAt: z.string().datetime({ offset: true }),
  reportDate: isoDateSchema.nullable(),
  shopIds: z.array(shopIdSchema).optional(),
});
const sourcesSchema = z.object({
  shopMonths: z.array(z.object({ shopId: shopIdSchema, months: z.array(monthSchema) })),
  imports: z.array(importSchema),
});
const persistedSchema = sourcesSchema.extend({ schemaVersion: z.literal(1), dirty: z.literal(false) });
const reference = adminDb.collection("dashboardPeriodIndexes").doc("current");

export type DashboardPeriodSources = z.infer<typeof sourcesSchema>;

async function legacyReportDate(importId: string) {
  const changes = await adminDb.collection("imports").doc(importId).collection("changes").limit(1).get();
  const change = z.object({ shopId: shopIdSchema, performanceId: shopIdSchema }).safeParse(changes.docs[0]?.data());
  if (!change.success) return null;
  const performance = await adminDb.collection("shops").doc(change.data.shopId)
    .collection("performance").doc(change.data.performanceId).get();
  const dates = z.object({ date: isoDateSchema, asOfDate: isoDateSchema.optional() }).safeParse(performance.data());
  return dates.success ? dates.data.asOfDate ?? dates.data.date : null;
}

async function scanPeriodSources(): Promise<DashboardPeriodSources> {
  const [shops, imports] = await Promise.all([
    adminDb.collection("shops").select("monthlyData").get(),
    adminDb.collection("imports").where("status", "==", "active")
      .orderBy("createdAt", "desc").select("month", "createdAt", "reportDate", "shopIds").get(),
  ]);
  const shopMonths = shops.docs.flatMap(document => {
    const shopId = shopIdSchema.safeParse(document.id);
    if (!shopId.success) return [];
    const monthlyData = document.data().monthlyData;
    const months = monthlyData && typeof monthlyData === "object" && !Array.isArray(monthlyData)
      ? Object.keys(monthlyData).filter(month => monthSchema.safeParse(month).success)
      : [];
    return [{ shopId: shopId.data, months }];
  });
  const activeImports: Array<z.infer<typeof importSchema>> = [];
  for (let start = 0; start < imports.docs.length; start += 20) {
    const chunk = await Promise.all(imports.docs.slice(start, start + 20).map(async document => {
      const parsed = z.object({
        month: monthSchema,
        createdAt: z.string().datetime({ offset: true }),
        reportDate: isoDateSchema.optional(),
        shopIds: z.array(shopIdSchema).optional(),
      }).safeParse(document.data());
      const id = shopIdSchema.safeParse(document.id);
      if (!parsed.success || !id.success) return null;
      return {
        id: id.data,
        ...parsed.data,
        reportDate: parsed.data.reportDate ?? await legacyReportDate(id.data),
      };
    }));
    activeImports.push(...chunk.filter((item): item is NonNullable<typeof item> => item !== null));
  }
  return { shopMonths, imports: activeImports };
}

function canPersist(sources: DashboardPeriodSources) {
  return Buffer.byteLength(JSON.stringify(sources), "utf8") <= MAX_INDEX_BYTES;
}

export async function loadDashboardPeriodSources(): Promise<DashboardPeriodSources> {
  const snapshot = await reference.get();
  const parsed = persistedSchema.safeParse(snapshot.data());
  if (parsed.success) return { shopMonths: parsed.data.shopMonths, imports: parsed.data.imports };

  const sources = await scanPeriodSources();
  if (canPersist(sources) && snapshot.data()?.dirty !== true) {
    await adminDb.runTransaction(async transaction => {
      const current = await transaction.get(reference);
      if (current.data()?.dirty === true || persistedSchema.safeParse(current.data()).success) return;
      transaction.set(reference, { schemaVersion: 1, dirty: false, ...sources, updatedAt: new Date().toISOString() });
    });
  }
  return sources;
}

export async function markDashboardPeriodIndexDirty() {
  const refreshId = randomUUID();
  await reference.set({ dirty: true, refreshId }, { merge: true });
  return refreshId;
}

export async function syncDashboardPeriodIndex(refreshId: string) {
  const sources = await scanPeriodSources();
  if (!canPersist(sources)) {
    console.warn("Dashboard period index is too large; using projected reads.");
    return;
  }
  await adminDb.runTransaction(async transaction => {
    const current = await transaction.get(reference);
    if (current.data()?.refreshId !== refreshId) return;
    transaction.set(reference, { schemaVersion: 1, dirty: false, ...sources, updatedAt: new Date().toISOString() });
  });
}
