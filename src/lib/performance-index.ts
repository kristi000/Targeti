import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { adminDb } from "@/lib/firebase-admin";
import { performanceDataSchema, shopIdSchema } from "@/lib/persistence-schemas";
import type { PerformanceIndexEntry } from "@/lib/types";

const MAX_INDEX_ENTRIES = 5000;
const MAX_INDEX_BYTES = 750_000;
const indexEntrySchema = performanceDataSchema
  .pick({ date: true, importId: true, importName: true, importedAt: true, asOfDate: true })
  .extend({ id: shopIdSchema });
const persistedIndexSchema = z.object({
  schemaVersion: z.literal(1),
  dirty: z.literal(false),
  entries: z.array(indexEntrySchema).max(MAX_INDEX_ENTRIES),
}).passthrough();

function indexReference(shopId: string) {
  return adminDb.collection("shops").doc(shopId).collection("metadata").doc("performanceIndex");
}

function canPersist(entries: PerformanceIndexEntry[]) {
  return entries.length <= MAX_INDEX_ENTRIES && Buffer.byteLength(JSON.stringify(entries), "utf8") <= MAX_INDEX_BYTES;
}

async function scanPerformanceIndex(shopId: string): Promise<PerformanceIndexEntry[]> {
  const snapshot = await adminDb.collection("shops").doc(shopId).collection("performance")
    .select("date", "importId", "importName", "importedAt", "asOfDate")
    .get();
  return snapshot.docs.flatMap(document => {
    const result = indexEntrySchema.safeParse({ id: document.id, ...document.data() });
    if (result.success) return [result.data];
    console.error(`Ignoring invalid performance index entry ${document.ref.path}:`, result.error.flatten());
    return [];
  });
}

export async function loadPerformanceIndex(shopId: string): Promise<PerformanceIndexEntry[]> {
  const reference = indexReference(shopId);
  const snapshot = await reference.get();
  const parsed = persistedIndexSchema.safeParse(snapshot.data());
  if (parsed.success) return parsed.data.entries;

  const entries = await scanPerformanceIndex(shopId);
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

export async function markPerformanceIndexesDirty(shopIds: string[]) {
  const refreshId = randomUUID();
  for (let start = 0; start < shopIds.length; start += 450) {
    const batch = adminDb.batch();
    shopIds.slice(start, start + 450).forEach(shopId => {
      batch.set(indexReference(shopId), { dirty: true, refreshId }, { merge: true });
    });
    await batch.commit();
  }
  return refreshId;
}

export async function syncPerformanceIndexes(shopIds: string[], refreshId: string) {
  for (let start = 0; start < shopIds.length; start += 10) {
    await Promise.all(shopIds.slice(start, start + 10).map(async shopId => {
      const [shop, entries] = await Promise.all([
        adminDb.collection("shops").doc(shopId).get(),
        scanPerformanceIndex(shopId),
      ]);
      if (!canPersist(entries)) {
        console.warn(`Performance index for shop ${shopId} is too large; using projected reads.`);
        return;
      }
      const reference = indexReference(shopId);
      await adminDb.runTransaction(async transaction => {
        const current = await transaction.get(reference);
        if (current.data()?.refreshId !== refreshId) return;
        if (!shop.exists) {
          transaction.delete(reference);
          return;
        }
        transaction.set(reference, {
          schemaVersion: 1,
          dirty: false,
          entries,
          updatedAt: new Date().toISOString(),
        });
      });
    }));
  }
}
