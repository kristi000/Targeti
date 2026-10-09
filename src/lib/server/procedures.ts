import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { adminDb as db, documentId } from "@/lib/firebase-admin";
import { requireAdmin, requireEditorForShops, requireShopAccess } from "@/lib/access";
import { attendanceMonthSchema, procedureFieldsSchema, procedureRecordSchema, procedureSummarySchema, procedureFilterSchema, shopIdSchema, shopSchema, deletedProcedureSchema } from "@/lib/persistence-schemas";
import { adjustProcedureSummary, EMPTY_PROCEDURE_SUMMARY, procedureProductStatus, type ProcedureFilter, type ProcedureSummary, type ProceduresPage } from "@/lib/procedures";
import { createActivity, toFirestoreData } from "@/app/actions/shared";

export const procedureCursorSchema = z.string().regex(/^[01]-[a-zA-Z0-9-]{1,120}$/);
export const saveProceduresSchema = z.object({
  shopId: shopIdSchema, month: attendanceMonthSchema,
  changes: z.array(z.object({ id: procedureCursorSchema.optional(), expectedRevision: z.number().int().nonnegative(), fields: procedureFieldsSchema, representativeId: shopSchema.shape.salesRepresentatives.unwrap().element.shape.id.optional() }).strict()).min(1).max(50),
}).strict().refine(value => new Set(value.changes.flatMap(change => change.id ? [change.id] : [])).size === value.changes.filter(change => change.id).length, "Duplicate procedure");

// Backfill older month summaries once, from every page, without changing records or their revisions.
async function ensureProductSummary(shopId: string, month: string) {
  const shop = db.collection("shops").doc(shopId);
  const ref = shop.collection("procedureMonths").doc(month);
  return db.runTransaction(async transaction => {
    const [shopSnapshot, snapshot] = await Promise.all([transaction.get(shop), transaction.get(ref)]);
    if (!shopSnapshot.exists) throw new Error("notFound");
    const existing = snapshot.exists ? procedureSummarySchema.parse(snapshot.data()) : null;
    if (existing?.totalMixMax !== undefined) return existing;
    const summary = { ...EMPTY_PROCEDURE_SUMMARY, revision: existing?.revision ?? 0 };
    let cursor: string | undefined;
    while (true) {
      let query = ref.collection("records").orderBy(documentId()).limit(200);
      if (cursor) query = query.startAfter(cursor);
      const page = await transaction.get(query);
      for (const record of page.docs) {
        const entry = procedureRecordSchema.parse({ ...record.data(), id: record.id });
        if (entry.month !== month) throw new Error("invalidData");
        adjustProcedureSummary(summary, entry, 1);
      }
      if (page.size < 200) break;
      cursor = page.docs[page.size - 1].id;
    }
    const parsed = procedureSummarySchema.parse(summary);
    if (snapshot.exists || summary.total > 0) transaction.set(ref, parsed);
    return parsed;
  });
}

export async function getProcedureSummary(shopId: string, month: string): Promise<ProcedureSummary | null> {
  const validShopId = shopIdSchema.parse(shopId);
  const validMonth = attendanceMonthSchema.parse(month);
  await requireShopAccess(validShopId);
  const snapshot = await db.collection("shops").doc(validShopId).collection("procedureMonths").doc(validMonth).get();
  if (!snapshot.exists) return null;
  return ensureProductSummary(validShopId, validMonth);
}

// Build the single-field combined-filter projection in bounded transactions. Business revisions stay unchanged.
async function ensureProcedureFilterIndex(shopId: string, month: string) {
  const ref = db.collection("shops").doc(shopId).collection("procedureMonths").doc(month);
  let cursor: string | undefined;
  while (true) {
    const result: { done: boolean; cursor?: string } = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const summary = snapshot.exists ? procedureSummarySchema.parse(snapshot.data()) : { ...EMPTY_PROCEDURE_SUMMARY };
      if (summary.filterIndexVersion === 1) return { done: true };
      let query = ref.collection("records").orderBy(documentId()).limit(200);
      if (cursor) query = query.startAfter(cursor);
      const records = await transaction.get(query);
      for (const record of records.docs) {
        const entry = procedureRecordSchema.parse({ ...record.data(), id: record.id });
        if (entry.month !== month) throw new Error("invalidData");
        const productStatus = procedureProductStatus(entry);
        if (entry.productStatus !== productStatus) transaction.update(record.ref, { productStatus });
      }
      const done = records.size < 200;
      if (done && snapshot.exists) transaction.set(ref, procedureSummarySchema.parse({ ...summary, filterIndexVersion: 1 }));
      return { done, cursor: records.docs.at(-1)?.id };
    });
    if (result.done) return;
    cursor = result.cursor;
  }
}

export async function loadProcedures(shopId: string, month: string, cursor?: string, inputFilter: ProcedureFilter = {}): Promise<ProceduresPage> {
  shopIdSchema.parse(shopId); attendanceMonthSchema.parse(month);
  const filter = procedureFilterSchema.parse(inputFilter);
  if (cursor !== undefined) procedureCursorSchema.parse(cursor);
  await requireShopAccess(shopId);
  const shop = db.collection("shops").doc(shopId);
  const ref = shop.collection("procedureMonths").doc(month);
  const summary = await ensureProductSummary(shopId, month);
  if (filter.product && filter.status) await ensureProcedureFilterIndex(shopId, month);
  let query = ref.collection("records").orderBy(documentId());
  if (filter.product && filter.status) query = query.where("productStatus", "==", procedureProductStatus({ product: filter.product, status: filter.status }));
  else if (filter.product) query = query.where("product", "==", filter.product);
  else if (filter.status) query = query.where("status", "==", filter.status);
  if (cursor) query = query.startAfter(cursor);
  const [shopSnapshot, records] = await Promise.all([shop.get(), query.limit(51).get()]);
  if (!shopSnapshot.exists) throw new Error("notFound");
  const items = records.docs.slice(0, 50).map(record => procedureRecordSchema.parse({ ...record.data(), id: record.id }));
  if (items.some(item => item.month !== month)) throw new Error("invalidData");
  if (items.some(item => (filter.product && item.product !== filter.product) || (filter.status && item.status !== filter.status))) throw new Error("invalidData");
  return { items, summary, nextCursor: records.size > 50 ? items[items.length - 1].id : null };
}

export async function saveProcedures(input: z.infer<typeof saveProceduresSchema>) {
  const value = saveProceduresSchema.parse(input);
  const actor = await requireEditorForShops([value.shopId]);
  await ensureProductSummary(value.shopId, value.month);
  // New entries come from the selected Daily Closing date. Imported dates may be retained when editing.
  if (value.changes.some(change => !change.id && !change.fields.dateTime.startsWith(`${value.month}-`))) throw new Error("invalidData");
  const shop = db.collection("shops").doc(value.shopId);
  const ref = shop.collection("procedureMonths").doc(value.month);
  const now = new Date().toISOString();
  const changes = value.changes.map(change => ({ ...change, id: change.id ?? `1-${Date.now()}-${randomUUID()}` }));
  const activity = await createActivity({ action: "procedures_saved", summary: `Updated ${changes.length} procedure(s) for ${value.month}.`, shopIds: [value.shopId], shopNames: [], metadata: { month: value.month, count: changes.length } }, actor);
  await db.runTransaction(async transaction => {
    const [shopSnapshot, summarySnapshot, ...snapshots] = await Promise.all([
      transaction.get(shop), transaction.get(ref), ...changes.map(change => transaction.get(ref.collection("records").doc(change.id))),
      ...changes.map(change => transaction.get(ref.collection("deletedRecords").doc(change.id))),
    ]);
    if (!shopSnapshot.exists) throw new Error("notFound");
    const summary = summarySnapshot.exists ? procedureSummarySchema.parse(summarySnapshot.data()) : { ...EMPTY_PROCEDURE_SUMMARY };
    const shopData = shopSchema.parse({ ...shopSnapshot.data(), id: shopSnapshot.id });
    const representatives = shopData.monthlyData?.[value.month]?.representatives ?? shopData.salesRepresentatives ?? [];
    const records = changes.map((change, index) => {
      const existing = snapshots[index].exists ? procedureRecordSchema.parse({ ...snapshots[index].data(), id: change.id }) : null;
      if (snapshots[index + changes.length].exists) throw new Error("conflict");
      if ((existing?.revision ?? 0) !== change.expectedRevision) throw new Error("conflict");
      if (!existing && (change.id.startsWith("0-") || !change.fields.dateTime.startsWith(`${value.month}-`))) throw new Error("invalidData");
      const representative = representatives.find(item => item.id === change.representativeId);
      if ((!existing || change.representativeId !== undefined) && !representative) throw new Error("representativeRequired");
      const fields = representative ? { ...change.fields, user: representative.name } : change.fields;
      if (existing) adjustProcedureSummary(summary, existing, -1);
      const record = procedureRecordSchema.parse({ ...fields, productStatus: procedureProductStatus(fields), id: change.id, month: value.month, revision: (existing?.revision ?? 0) + 1,
        createdAt: existing?.createdAt ?? now, updatedAt: now, updatedBy: actor.id, ...(existing?.source ? { source: existing.source } : {}) });
      adjustProcedureSummary(summary, record, 1);
      return record;
    });
    summary.revision += 1;
    transaction.set(ref, procedureSummarySchema.parse(summary));
    for (const record of records) transaction.set(ref.collection("records").doc(record.id), toFirestoreData(record));
    transaction.set(activity.reference, activity.data);
  });
}

export const deleteProceduresSchema = z.object({
  shopId: shopIdSchema,
  month: attendanceMonthSchema,
  records: z.array(z.object({ id: procedureCursorSchema, expectedRevision: z.number().int().positive() }).strict()).min(1).max(50),
}).strict().refine(value => new Set(value.records.map(record => record.id)).size === value.records.length, "Duplicate procedure");

export async function deleteProcedures(input: z.infer<typeof deleteProceduresSchema>) {
  const value = deleteProceduresSchema.parse(input);
  const actor = await requireEditorForShops([value.shopId]);
  await ensureProductSummary(value.shopId, value.month);
  const shop = db.collection("shops").doc(value.shopId);
  const ref = shop.collection("procedureMonths").doc(value.month);
  const activity = await createActivity({ action: "procedures_deleted", summary: `Deleted ${value.records.length} procedure(s) for ${value.month}.`, shopIds: [value.shopId], shopNames: [], metadata: { month: value.month, count: value.records.length } }, actor);
  const now = new Date().toISOString();
  await db.runTransaction(async transaction => {
    const [shopSnapshot, summarySnapshot, ...snapshots] = await Promise.all([
      transaction.get(shop), transaction.get(ref), ...value.records.map(record => transaction.get(ref.collection("records").doc(record.id))),
    ]);
    if (!shopSnapshot.exists) throw new Error("notFound");
    if (!summarySnapshot.exists) throw new Error("conflict");
    const summary = procedureSummarySchema.parse(summarySnapshot.data());
    value.records.forEach((target, index) => {
      if (!snapshots[index].exists) throw new Error("conflict");
      const record = procedureRecordSchema.parse({ ...snapshots[index].data(), id: target.id });
      if (record.month !== value.month) throw new Error("invalidData");
      if (record.revision !== target.expectedRevision) throw new Error("conflict");
      adjustProcedureSummary(summary, record, -1);
      transaction.create(ref.collection("deletedRecords").doc(target.id), deletedProcedureSchema.parse({ ...record, revision: record.revision + 1, deletedAt: now, deletedBy: actor.id }));
    });
    summary.revision += 1;
    transaction.set(ref, procedureSummarySchema.parse(summary));
    value.records.forEach(record => transaction.delete(ref.collection("records").doc(record.id)));
    transaction.set(activity.reference, activity.data);
  });
}

export async function loadDeletedProcedures(shopId: string, month: string, cursor?: string) {
  shopIdSchema.parse(shopId); attendanceMonthSchema.parse(month);
  if (cursor !== undefined) procedureCursorSchema.parse(cursor);
  await requireEditorForShops([shopId]);
  const shop = db.collection("shops").doc(shopId);
  let query = shop.collection("procedureMonths").doc(month).collection("deletedRecords").orderBy(documentId());
  if (cursor) query = query.startAfter(cursor);
  const [shopSnapshot, snapshot] = await Promise.all([shop.get(), query.limit(51).get()]);
  if (!shopSnapshot.exists) throw new Error("notFound");
  const items = snapshot.docs.slice(0, 50).map(doc => deletedProcedureSchema.parse({ ...doc.data(), id: doc.id }));
  if (items.some(item => item.month !== month)) throw new Error("invalidData");
  return { items, nextCursor: snapshot.size > 50 ? items.at(-1)!.id : null };
}

export async function restoreProcedures(input: z.infer<typeof deleteProceduresSchema>) {
  const value = deleteProceduresSchema.parse(input);
  const actor = await requireEditorForShops([value.shopId]);
  await ensureProductSummary(value.shopId, value.month);
  const shop = db.collection("shops").doc(value.shopId);
  const ref = shop.collection("procedureMonths").doc(value.month);
  const now = new Date().toISOString();
  const activity = await createActivity({ action: "procedures_restored", summary: `Restored ${value.records.length} procedure(s) for ${value.month}.`, shopIds: [value.shopId], shopNames: [], metadata: { month: value.month, count: value.records.length } }, actor);
  await db.runTransaction(async transaction => {
    const [shopSnapshot, summarySnapshot, ...snapshots] = await Promise.all([
      transaction.get(shop), transaction.get(ref),
      ...value.records.map(record => transaction.get(ref.collection("deletedRecords").doc(record.id))),
      ...value.records.map(record => transaction.get(ref.collection("records").doc(record.id))),
    ]);
    if (!shopSnapshot.exists) throw new Error("notFound");
    const summary = summarySnapshot.exists ? procedureSummarySchema.parse(summarySnapshot.data()) : { ...EMPTY_PROCEDURE_SUMMARY };
    const records = value.records.map((target, index) => {
      if (!snapshots[index].exists || snapshots[index + value.records.length].exists) throw new Error("conflict");
      const deleted = deletedProcedureSchema.parse({ ...snapshots[index].data(), id: target.id });
      if (deleted.month !== value.month) throw new Error("invalidData");
      if (deleted.revision !== target.expectedRevision) throw new Error("conflict");
      const original = procedureRecordSchema.strip().parse(deleted);
      const record = procedureRecordSchema.parse({ ...original, productStatus: procedureProductStatus(original), revision: original.revision + 1, updatedAt: now, updatedBy: actor.id });
      adjustProcedureSummary(summary, record, 1);
      return record;
    });
    summary.revision += 1;
    transaction.set(ref, procedureSummarySchema.parse(summary));
    for (const record of records) {
      transaction.create(ref.collection("records").doc(record.id), toFirestoreData(record));
      transaction.delete(ref.collection("deletedRecords").doc(record.id));
    }
    transaction.set(activity.reference, activity.data);
  });
}

export const procedureImportSchema = z.object({ month: attendanceMonthSchema, correctReversedDates: z.boolean(), expectedRevision: z.number().int().nonnegative() }).strict();

export async function importProcedures(shopId: string, input: z.infer<typeof procedureImportSchema>, fileHash: string,
  rows: Array<{ fields: z.infer<typeof procedureFieldsSchema>; row: number; originalDateTime: string }>) {
  shopIdSchema.parse(shopId);
  const value = procedureImportSchema.parse(input);
  z.string().regex(/^[a-f0-9]{64}$/).parse(fileHash);
  const validRows = z.array(z.object({ fields: procedureFieldsSchema, row: z.number().int().min(2), originalDateTime: procedureRecordSchema.shape.source.unwrap().shape.originalDateTime }).strict()).min(1).max(400).parse(rows);
  const actor = await requireEditorForShops([shopId]);
  await ensureProductSummary(shopId, value.month);
  const shop = db.collection("shops").doc(shopId);
  const ref = shop.collection("procedureMonths").doc(value.month);
  const markerRef = ref.collection("imports").doc(fileHash);
  const now = new Date().toISOString();
  const activity = await createActivity({ action: "procedures_imported", summary: `Imported ${validRows.length} procedure(s) for ${value.month}.`, shopIds: [shopId], shopNames: [], metadata: { month: value.month, count: validRows.length, correctedDates: value.correctReversedDates } }, actor);
  await db.runTransaction(async transaction => {
    const [shopSnapshot, summarySnapshot, marker] = await Promise.all([transaction.get(shop), transaction.get(ref), transaction.get(markerRef)]);
    if (!shopSnapshot.exists) throw new Error("notFound");
    if (marker.exists) throw new Error("alreadyImported");
    const summary = summarySnapshot.exists ? procedureSummarySchema.parse(summarySnapshot.data()) : { ...EMPTY_PROCEDURE_SUMMARY };
    if (summary.revision !== value.expectedRevision) throw new Error("conflict");
    for (const row of validRows) {
      const record = procedureRecordSchema.parse({ ...row.fields, productStatus: procedureProductStatus(row.fields), id: `0-${fileHash}-${String(row.row).padStart(6, "0")}`, month: value.month, revision: 1,
        createdAt: now, updatedAt: now, updatedBy: actor.id, source: { fileHash, row: row.row, originalDateTime: row.originalDateTime } });
      transaction.create(ref.collection("records").doc(record.id), record);
      adjustProcedureSummary(summary, record, 1);
    }
    summary.revision += 1;
    transaction.set(ref, procedureSummarySchema.parse(summary));
    transaction.create(markerRef, { count: validRows.length, importedAt: now, importedBy: actor.id, correctReversedDates: value.correctReversedDates });
    transaction.set(activity.reference, activity.data);
  });
}

export async function deleteShopProcedures(shopId: string) {
  shopIdSchema.parse(shopId);
  await requireAdmin();
  await db.recursiveDelete(db.collection("shops").doc(shopId).collection("procedureMonths"));
}
