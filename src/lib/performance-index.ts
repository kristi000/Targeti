import "server-only";

import { randomUUID } from "node:crypto";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { z } from "zod";

import { adminDb } from "@/lib/firebase-admin";
import { monthSchema, performanceDataSchema, shopIdSchema } from "@/lib/persistence-schemas";
import type { PerformanceIndexEntry } from "@/lib/types";

const MAX_INDEX_ENTRIES = 5000;
const MAX_INDEX_BYTES = 750_000;
const MAX_DIRTY_MONTHS = 120;
const refreshShopsSchema = z.array(shopIdSchema).max(500);
const refreshMonthsSchema = z.array(monthSchema).max(MAX_DIRTY_MONTHS).optional();
const indexEntrySchema = performanceDataSchema
  .pick({ date: true, importId: true, importName: true, importedAt: true, asOfDate: true })
  .extend({ id: shopIdSchema });
type ValidatedIndexEntry = z.infer<typeof indexEntrySchema>;
const indexContentsSchema = z.object({
  schemaVersion: z.literal(1),
  dirty: z.boolean(),
  entries: z.array(indexEntrySchema).max(MAX_INDEX_ENTRIES)
    .refine(entries => new Set(entries.map(entry => entry.id)).size === entries.length, "Duplicate performance entry"),
}).passthrough();
const persistedIndexSchema = indexContentsSchema.extend({ dirty: z.literal(false) });
const cleanIndexMarkerSchema = z.object({ schemaVersion: z.literal(1), dirty: z.literal(false) });
const dirtyIndexSchema = z.object({
  schemaVersion: z.literal(1),
  dirty: z.literal(true),
  refreshId: z.string().uuid(),
  dirtyMonths: z.array(monthSchema).min(1).max(MAX_DIRTY_MONTHS)
    .refine(months => new Set(months).size === months.length, "Duplicate dirty month").nullable(),
});

function indexReference(shopId: string) {
  return adminDb.collection("shops").doc(shopId).collection("metadata").doc("performanceIndex");
}

function canPersist(entries: PerformanceIndexEntry[]) {
  return entries.length <= MAX_INDEX_ENTRIES && Buffer.byteLength(JSON.stringify(entries), "utf8") <= MAX_INDEX_BYTES;
}

async function scanPerformanceIndex(shopId: string, months?: string[]): Promise<{
  entries: ValidatedIndexEntry[];
  documentIds: string[];
}> {
  const performance = adminDb.collection("shops").doc(shopId).collection("performance")
    .select("date", "importId", "importName", "importedAt", "asOfDate");
  const documents: QueryDocumentSnapshot[] = [];
  if (!months) {
    documents.push(...(await performance.get()).docs);
  } else {
    for (let start = 0; start < months.length; start += 10) {
      const snapshots = await Promise.all(months.slice(start, start + 10).map(month => performance
        .where("date", ">=", `${month}-`)
        .where("date", "<", `${month}.`)
        .orderBy("date", "asc")
        .get()));
      snapshots.forEach(snapshot => documents.push(...snapshot.docs));
    }
  }
  const entries = documents.flatMap(document => {
    const result = indexEntrySchema.safeParse({ id: document.id, ...document.data() });
    if (result.success) return [result.data];
    console.error(`Ignoring invalid performance index entry ${document.ref.path}:`, result.error.flatten());
    return [];
  });
  return { entries, documentIds: documents.map(document => document.id) };
}

export async function loadPerformanceIndex(shopId: string): Promise<PerformanceIndexEntry[]> {
  const validShopId = shopIdSchema.parse(shopId);
  const reference = indexReference(validShopId);
  const snapshot = await reference.get();
  const parsed = persistedIndexSchema.safeParse(snapshot.data());
  if (parsed.success) return parsed.data.entries;

  const { entries } = await scanPerformanceIndex(validShopId);
  if (canPersist(entries) && snapshot.data()?.dirty !== true) {
    await adminDb.runTransaction(async transaction => {
      const current = await transaction.get(reference);
      if (current.data()?.dirty === true || persistedIndexSchema.safeParse(current.data()).success) return;
      transaction.set(reference, {
        schemaVersion: 1,
        dirty: false,
        entries,
        updatedAt: new Date().toISOString(),
      });
    });
  }
  return entries;
}

export async function markPerformanceIndexesDirty(shopIds: string[], months?: string[]) {
  const validShopIds = [...new Set(refreshShopsSchema.parse(shopIds))];
  const requestedMonths = [...new Set(refreshMonthsSchema.parse(months) ?? [])];
  const refreshId = randomUUID();
  for (let start = 0; start < validShopIds.length; start += 450) {
    const references = validShopIds.slice(start, start + 450).map(indexReference);
    await adminDb.runTransaction(async transaction => {
      const current = await transaction.getAll(...references, {
        fieldMask: ["schemaVersion", "dirty", "refreshId", "dirtyMonths"],
      });
      current.forEach(snapshot => {
        const clean = cleanIndexMarkerSchema.safeParse(snapshot.data());
        const pending = dirtyIndexSchema.safeParse(snapshot.data());
        // A prior unscoped/legacy refresh must be repaired in full. Scoped
        // refreshes retain all pending months until one owner rebuilds them.
        const pendingMonths = clean.success ? [] : pending.success ? pending.data.dirtyMonths : null;
        const combinedMonths = pendingMonths && requestedMonths.length
          ? [...new Set([...pendingMonths, ...requestedMonths])]
          : null;
        const dirtyMonths = combinedMonths && combinedMonths.length <= MAX_DIRTY_MONTHS ? combinedMonths : null;
        transaction.set(snapshot.ref, { dirty: true, refreshId, dirtyMonths }, { merge: true });
      });
    });
  }
  return refreshId;
}

export async function syncPerformanceIndexes(shopIds: string[], refreshId: string, months?: string[]) {
  const validShopIds = [...new Set(refreshShopsSchema.parse(shopIds))];
  const validRefreshId = z.string().uuid().parse(refreshId);
  const requestedMonths = refreshMonthsSchema.parse(months);
  for (let start = 0; start < validShopIds.length; start += 10) {
    await Promise.all(validShopIds.slice(start, start + 10).map(async shopId => {
      const reference = indexReference(shopId);
      const shopReference = adminDb.collection("shops").doc(shopId);
      for (let attempt = 0; attempt < 3; attempt++) {
        const snapshot = await reference.get();
        if (snapshot.data()?.refreshId !== validRefreshId) return;
        const baseline = indexContentsSchema.safeParse(snapshot.data());
        const pending = dirtyIndexSchema.safeParse(snapshot.data());
        const scopedMonths = requestedMonths?.length && baseline.success && canPersist(baseline.data.entries) && pending.success
          ? pending.data.dirtyMonths ?? undefined
          : undefined;
        const { entries: refreshedEntries, documentIds } = await scanPerformanceIndex(shopId, scopedMonths);
        const affectedMonths = new Set(scopedMonths);
        const refreshedIds = new Set(documentIds);
        const entries = scopedMonths && baseline.success
          ? [
            ...baseline.data.entries.filter(entry => !affectedMonths.has(entry.date.slice(0, 7)) && !refreshedIds.has(entry.id)),
            ...refreshedEntries,
          ]
          : refreshedEntries;
        // Keep the full-query document order for selectors whose date sort
        // preserves input order when import timestamps tie.
        if (scopedMonths) entries.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
        if (!canPersist(entries)) {
          console.warn(`Performance index for shop ${shopId} is too large; using projected reads.`);
          return;
        }
        const outcome = await adminDb.runTransaction(async transaction => {
          const [current, shop] = await transaction.getAll(reference, shopReference, { fieldMask: ["refreshId"] });
          if (current.data()?.refreshId !== validRefreshId) return "obsolete";
          if (!snapshot.updateTime || !current.updateTime?.isEqual(snapshot.updateTime)) return "retry";
          if (!shop.exists) {
            transaction.delete(reference);
            return "complete";
          }
          transaction.set(reference, {
            schemaVersion: 1,
            dirty: false,
            entries,
            updatedAt: new Date().toISOString(),
          });
          return "complete";
        });
        if (outcome !== "retry") return;
      }
      throw new Error(`Performance index refresh for shop ${shopId} changed repeatedly; retry the projection refresh.`);
    }));
  }
}
