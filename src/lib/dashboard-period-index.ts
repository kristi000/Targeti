import "server-only";

import { randomUUID } from "node:crypto";
import type { DocumentSnapshot, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { z } from "zod";

import { adminDb } from "@/lib/firebase-admin";
import { isoDateSchema, monthSchema, shopIdSchema } from "@/lib/persistence-schemas";

const MAX_INDEX_BYTES = 750_000;
const MAX_DIRTY_SHOPS = 500;
const MAX_DIRTY_MONTHS = 120;
const importSchema = z.object({
  id: shopIdSchema,
  month: monthSchema,
  createdAt: z.string().datetime({ offset: true }),
  reportDate: isoDateSchema.nullable(),
  shopIds: z.array(shopIdSchema).optional(),
});
const sourcesSchema = z.object({
  shopMonths: z.array(z.object({
    shopId: shopIdSchema,
    months: z.array(monthSchema).refine(months => new Set(months).size === months.length, "Duplicate shop month"),
  })).refine(shops => new Set(shops.map(shop => shop.shopId)).size === shops.length, "Duplicate period shop"),
  imports: z.array(importSchema)
    .refine(imports => new Set(imports.map(item => item.id)).size === imports.length, "Duplicate period import"),
});
const indexContentsSchema = sourcesSchema.extend({ schemaVersion: z.literal(1), dirty: z.boolean() });
const persistedSchema = indexContentsSchema.extend({ dirty: z.literal(false) });
const cleanIndexMarkerSchema = z.object({ schemaVersion: z.literal(1), dirty: z.literal(false) });
const refreshSchema = z.object({
  shopIds: z.array(shopIdSchema).min(1).max(MAX_DIRTY_SHOPS),
  months: z.array(monthSchema).max(MAX_DIRTY_MONTHS).optional(),
  importsChanged: z.boolean().optional(),
}).strict();
const dirtyScopeSchema = z.object({
  shopIds: z.array(shopIdSchema).min(1).max(MAX_DIRTY_SHOPS)
    .refine(shops => new Set(shops).size === shops.length, "Duplicate dirty shop"),
  importMonths: z.array(monthSchema).max(MAX_DIRTY_MONTHS)
    .refine(months => new Set(months).size === months.length, "Duplicate dirty month").nullable(),
}).strict();
const dirtyIndexSchema = z.object({
  schemaVersion: z.literal(1),
  dirty: z.literal(true),
  refreshId: z.string().uuid(),
  dirtyScope: dirtyScopeSchema.nullable(),
});
const importSourceSchema = z.object({
  month: monthSchema,
  createdAt: z.string().datetime({ offset: true }),
  reportDate: isoDateSchema.optional(),
  shopIds: z.array(shopIdSchema).optional(),
});
const reference = adminDb.collection("dashboardPeriodIndexes").doc("current");

export type DashboardPeriodSources = z.infer<typeof sourcesSchema>;
type DirtyScope = z.infer<typeof dirtyScopeSchema>;
type ScannedPeriodSources = { sources: DashboardPeriodSources; importDocumentIds: string[] };

function compareDocumentIds(left: string, right: string) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sortPeriodSources(sources: DashboardPeriodSources) {
  sources.shopMonths.sort((left, right) => compareDocumentIds(left.shopId, right.shopId));
  // Firestore appends document-name ordering in the same direction as the
  // createdAt ordering, so equal timestamps select the descending ID first.
  sources.imports.sort((left, right) =>
    left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : compareDocumentIds(right.id, left.id));
  return sources;
}

async function legacyReportDate(importId: string) {
  const changes = await adminDb.collection("imports").doc(importId).collection("changes").limit(1).get();
  const change = z.object({ shopId: shopIdSchema, performanceId: shopIdSchema }).safeParse(changes.docs[0]?.data());
  if (!change.success) return null;
  const performance = await adminDb.collection("shops").doc(change.data.shopId)
    .collection("performance").doc(change.data.performanceId).get();
  const dates = z.object({ date: isoDateSchema, asOfDate: isoDateSchema.optional() }).safeParse(performance.data());
  return dates.success ? dates.data.asOfDate ?? dates.data.date : null;
}

async function scanShopMonths(shopIds?: string[]): Promise<DashboardPeriodSources["shopMonths"]> {
  const documents: DocumentSnapshot[] = [];
  if (!shopIds) {
    documents.push(...(await adminDb.collection("shops").select("monthlyData").get()).docs);
  } else {
    for (let start = 0; start < shopIds.length; start += 100) {
      const references = shopIds.slice(start, start + 100).map(shopId => adminDb.collection("shops").doc(shopId));
      documents.push(...await adminDb.getAll(...references, { fieldMask: ["monthlyData"] }));
    }
  }
  return documents.flatMap(document => {
    const shopId = shopIdSchema.safeParse(document.id);
    if (!document.exists || !shopId.success) return [];
    const monthlyData = document.data()?.monthlyData;
    const months = monthlyData && typeof monthlyData === "object" && !Array.isArray(monthlyData)
      ? Object.keys(monthlyData).filter(month => monthSchema.safeParse(month).success)
      : [];
    return [{ shopId: shopId.data, months }];
  });
}

async function scanActiveImports(months?: string[]): Promise<{
  imports: DashboardPeriodSources["imports"];
  documentIds: string[];
}> {
  const imports = adminDb.collection("imports");
  const documents: QueryDocumentSnapshot[] = [];
  if (!months) {
    documents.push(...(await imports.where("status", "==", "active")
      .orderBy("createdAt", "desc").select("month", "createdAt", "reportDate", "shopIds").get()).docs);
  } else {
    for (let start = 0; start < months.length; start += 10) {
      // Equality index merging covers status/month without a new composite
      // index. The global createdAt/ID ordering happens after projection.
      const snapshots = await Promise.all(months.slice(start, start + 10).map(month => imports
        .where("status", "==", "active").where("month", "==", month)
        .select("month", "createdAt", "reportDate", "shopIds").get()));
      snapshots.forEach(snapshot => documents.push(...snapshot.docs));
    }
  }
  const activeImports: Array<z.infer<typeof importSchema>> = [];
  for (let start = 0; start < documents.length; start += 20) {
    const chunk = await Promise.all(documents.slice(start, start + 20).map(async document => {
      const parsed = importSourceSchema.safeParse(document.data());
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
  return { imports: activeImports, documentIds: documents.map(document => document.id) };
}

async function scanPeriodSources(scope?: DirtyScope): Promise<ScannedPeriodSources> {
  const [shopMonths, imports] = await Promise.all([
    scanShopMonths(scope?.shopIds),
    scope ? scope.importMonths === null ? scanActiveImports() : scanActiveImports(scope.importMonths) : scanActiveImports(),
  ]);
  return {
    sources: sortPeriodSources({ shopMonths, imports: imports.imports }),
    importDocumentIds: imports.documentIds,
  };
}

function mergePeriodSources(baseline: DashboardPeriodSources, refreshed: ScannedPeriodSources, scope: DirtyScope) {
  const changedShops = new Set(scope.shopIds);
  const changedMonths = new Set(scope.importMonths);
  const refreshedImportIds = new Set([
    ...refreshed.importDocumentIds,
    ...refreshed.sources.imports.map(item => item.id),
  ]);
  return sortPeriodSources({
    shopMonths: [...baseline.shopMonths.filter(shop => !changedShops.has(shop.shopId)), ...refreshed.sources.shopMonths],
    imports: scope.importMonths === null ? refreshed.sources.imports : [
      ...baseline.imports.filter(item => !changedMonths.has(item.month) && !refreshedImportIds.has(item.id)),
      ...refreshed.sources.imports,
    ],
  });
}

function canPersist(sources: DashboardPeriodSources) {
  return Buffer.byteLength(JSON.stringify({ shopMonths: sources.shopMonths, imports: sources.imports }), "utf8") <= MAX_INDEX_BYTES;
}

export async function loadDashboardPeriodSources(): Promise<DashboardPeriodSources> {
  const snapshot = await reference.get();
  const parsed = persistedSchema.safeParse(snapshot.data());
  if (parsed.success && canPersist(parsed.data)) return { shopMonths: parsed.data.shopMonths, imports: parsed.data.imports };

  const { sources } = await scanPeriodSources();
  if (canPersist(sources) && snapshot.data()?.dirty !== true) {
    await adminDb.runTransaction(async transaction => {
      const current = await transaction.get(reference);
      const currentIndex = persistedSchema.safeParse(current.data());
      if (current.data()?.dirty === true || currentIndex.success && canPersist(currentIndex.data)) return;
      transaction.set(reference, { schemaVersion: 1, dirty: false, ...sources, updatedAt: new Date().toISOString() });
    });
  }
  return sources;
}

export async function markDashboardPeriodIndexDirty(input?: z.infer<typeof refreshSchema>) {
  const parsed = input === undefined ? undefined : refreshSchema.parse(input);
  // Older pending jobs lack import scope. Keeping them unscoped also repairs
  // legacy report dates whose performance source may have been deleted.
  const requestedScope: DirtyScope | null = parsed?.importsChanged !== undefined ? {
    shopIds: [...new Set(parsed.shopIds)],
    importMonths: parsed.importsChanged ? parsed.months?.length ? [...new Set(parsed.months)] : null : [],
  } : null;
  const refreshId = randomUUID();
  await adminDb.runTransaction(async transaction => {
    const [snapshot] = await transaction.getAll(reference, {
      fieldMask: ["schemaVersion", "dirty", "refreshId", "dirtyScope"],
    });
    const clean = cleanIndexMarkerSchema.safeParse(snapshot.data());
    const pending = dirtyIndexSchema.safeParse(snapshot.data());
    const pendingScope = clean.success ? undefined : pending.success ? pending.data.dirtyScope : null;
    let dirtyScope = requestedScope;
    if (pendingScope === null || !requestedScope) {
      dirtyScope = null;
    } else if (pendingScope) {
      const shopIds = [...new Set([...pendingScope.shopIds, ...requestedScope.shopIds])];
      const importMonths = pendingScope.importMonths === null || requestedScope.importMonths === null
        ? null
        : [...new Set([...pendingScope.importMonths, ...requestedScope.importMonths])];
      dirtyScope = shopIds.length <= MAX_DIRTY_SHOPS && (importMonths === null || importMonths.length <= MAX_DIRTY_MONTHS)
        ? { shopIds, importMonths }
        : null;
    }
    transaction.set(reference, { dirty: true, refreshId, dirtyScope }, { merge: true });
  });
  return refreshId;
}

export async function syncDashboardPeriodIndex(refreshId: string) {
  const validRefreshId = z.string().uuid().parse(refreshId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await reference.get();
    if (snapshot.data()?.refreshId !== validRefreshId) return;
    const baseline = indexContentsSchema.safeParse(snapshot.data());
    const pending = dirtyIndexSchema.safeParse(snapshot.data());
    const scope = baseline.success && canPersist(baseline.data) && pending.success ? pending.data.dirtyScope ?? undefined : undefined;
    const refreshed = await scanPeriodSources(scope);
    const sources = scope && baseline.success ? mergePeriodSources(baseline.data, refreshed, scope) : refreshed.sources;
    if (!canPersist(sources)) {
      console.warn("Dashboard period index is too large; using projected reads.");
      return;
    }
    const outcome = await adminDb.runTransaction(async transaction => {
      const [current] = await transaction.getAll(reference, { fieldMask: ["refreshId"] });
      if (current.data()?.refreshId !== validRefreshId) return "obsolete";
      if (!snapshot.updateTime || !current.updateTime?.isEqual(snapshot.updateTime)) return "retry";
      transaction.set(reference, { schemaVersion: 1, dirty: false, ...sources, updatedAt: new Date().toISOString() });
      return "complete";
    });
    if (outcome !== "retry") return;
  }
  throw new Error("Dashboard period index changed repeatedly; retry the projection refresh.");
}
