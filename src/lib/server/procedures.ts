import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { adminDb as db, documentId } from "@/lib/firebase-admin";
import { requireAdmin, requireEditorForShops, requireShopAccess } from "@/lib/access";
import { attendanceMonthSchema, procedureFieldsSchema, procedureRecordSchema, procedureSummarySchema, procedureFilterSchema, procedureSortSchema, procedureUserOrderKeySchema, shopIdSchema, shopSchema, deletedProcedureSchema } from "@/lib/persistence-schemas";
import { adjustProcedureSummary, EMPTY_PROCEDURE_SUMMARY, procedureProductStatus, type ProcedureFilter, type ProcedureRecord, type ProcedureSort, type ProcedureSummary, type ProceduresPage } from "@/lib/procedures";
import { groupProcedureUserTotals, resolveProcedureUserName } from "@/lib/procedure-users";
import { getMonthlyRepresentatives, type SalesRepresentative } from "@/lib/types";
import { createActivity, toFirestoreData } from "@/app/actions/shared";

export const procedureCursorSchema = z.string().regex(/^[01]-[a-zA-Z0-9-]{1,120}$/);
export const saveProceduresSchema = z.object({
  shopId: shopIdSchema, month: attendanceMonthSchema,
  changes: z.array(z.object({ id: procedureCursorSchema.optional(), expectedRevision: z.number().int().nonnegative(), fields: procedureFieldsSchema, representativeId: shopSchema.shape.salesRepresentatives.unwrap().element.shape.id.optional() }).strict()).min(1).max(50),
}).strict().refine(value => new Set(value.changes.flatMap(change => change.id ? [change.id] : [])).size === value.changes.filter(change => change.id).length, "Duplicate procedure");

type ProcedureUserOrderField = "userOrder" | "productUserOrder" | "statusUserOrder" | "productStatusUserOrder";
type ProcedureUserFilterOrderField = "userFilterOrder" | "productUserFilterOrder" | "statusUserFilterOrder" | "productStatusUserFilterOrder";
const sortedProcedureCursorSchema = z.object({
  version: z.literal(1), shopId: shopIdSchema, month: attendanceMonthSchema,
  sort: procedureSortSchema, filter: procedureFilterSchema, key: procedureUserOrderKeySchema,
}).strict();

function procedureUserRosterHash(representatives: SalesRepresentative[]) {
  const roster = representatives.map(({ id, name }) => ({ id, name })).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  return createHash("sha256").update(JSON.stringify({ version: 1, roster }), "utf8").digest("hex");
}

function utf8Prefix(value: string, maxBytes: number) {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const length = Buffer.byteLength(character, "utf8");
    if (bytes + length > maxBytes) break;
    result += character;
    bytes += length;
  }
  return result;
}

function procedureUserOrderKey(user: string, id: string, scope: string) {
  const [firstName, ...surname] = user.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().split(/\s+/);
  // Keep the unique ID suffix intact even for unusually large Unicode decompositions.
  const budget = 1499 - Buffer.byteLength(`${scope}:\0\0${id}`, "utf8");
  const first = utf8Prefix(firstName, budget);
  const rest = utf8Prefix(surname.join(" "), budget - Buffer.byteLength(first, "utf8"));
  return procedureUserOrderKeySchema.parse(`${scope}:${first}\0${rest}\0${id}`);
}

function procedureUserIndexes(entry: Pick<ProcedureRecord, "id" | "user" | "product" | "status">, representatives: SalesRepresentative[]) {
  const user = resolveProcedureUserName(entry.user, representatives);
  const userHash = createHash("sha256").update(user, "utf8").digest("hex");
  const userFilterKey = (scope: string) => procedureUserOrderKeySchema.parse(`${scope}:${userHash}:${entry.id}`);
  return {
    userOrder: procedureUserOrderKey(user, entry.id, "all"),
    productUserOrder: procedureUserOrderKey(user, entry.id, entry.product),
    statusUserOrder: procedureUserOrderKey(user, entry.id, entry.status),
    productStatusUserOrder: procedureUserOrderKey(user, entry.id, procedureProductStatus(entry)),
    userFilterOrder: userFilterKey("all"),
    productUserFilterOrder: userFilterKey(entry.product),
    statusUserFilterOrder: userFilterKey(entry.status),
    productStatusUserFilterOrder: userFilterKey(procedureProductStatus(entry)),
  };
}

function procedureUserOrderScope(filter: ProcedureFilter): { field: ProcedureUserOrderField | ProcedureUserFilterOrderField; prefix: string; end: string } {
  const scope = filter.product && filter.status ? procedureProductStatus({ product: filter.product, status: filter.status })
    : filter.product ?? filter.status ?? "all";
  const field = filter.product && filter.status ? "productStatusUserOrder" : filter.product ? "productUserOrder" : filter.status ? "statusUserOrder" : "userOrder";
  if (filter.user !== undefined) {
    const userHash = createHash("sha256").update(filter.user, "utf8").digest("hex");
    const userField = filter.product && filter.status ? "productStatusUserFilterOrder" : filter.product ? "productUserFilterOrder" : filter.status ? "statusUserFilterOrder" : "userFilterOrder";
    return { field: userField, prefix: `${scope}:${userHash}:`, end: `${scope}:${userHash};` };
  }
  // Adjacent ASCII delimiters bound the complete scope, including names with arbitrary Unicode.
  return { field, prefix: `${scope}:`, end: `${scope};` };
}

function decodeSortedProcedureCursor(cursor: string, shopId: string, month: string, filter: ProcedureFilter, sort: ProcedureSort) {
  const token = z.string().max(4096).regex(/^u1\.[A-Za-z0-9_-]+$/).parse(cursor).slice(3);
  const decoded = Buffer.from(token, "base64url");
  if (decoded.toString("base64url") !== token) throw new Error("invalidData");
  let data: z.infer<typeof sortedProcedureCursorSchema>;
  try { data = sortedProcedureCursorSchema.parse(JSON.parse(decoded.toString("utf8"))); }
  catch { throw new Error("invalidData"); }
  const { prefix } = procedureUserOrderScope(filter);
  if (data.shopId !== shopId || data.month !== month || data.sort !== sort
    || data.filter.product !== filter.product || data.filter.status !== filter.status || data.filter.user !== filter.user
    || !data.key.startsWith(prefix)) throw new Error("invalidData");
  if (filter.user !== undefined) {
    procedureCursorSchema.parse(data.key.slice(prefix.length));
    return data.key;
  }
  const parts = data.key.slice(prefix.length).split("\0");
  if (parts.length !== 3) throw new Error("invalidData");
  procedureCursorSchema.parse(parts[2]);
  return data.key;
}

function encodeSortedProcedureCursor(key: string, shopId: string, month: string, filter: ProcedureFilter, sort: ProcedureSort) {
  const data = sortedProcedureCursorSchema.parse({ version: 1, shopId, month, sort, filter, key });
  return `u1.${Buffer.from(JSON.stringify(data), "utf8").toString("base64url")}`;
}

// Backfill older monthly product/user totals from every page without changing business revisions.
async function ensureProductSummary(shopId: string, month: string) {
  const shop = db.collection("shops").doc(shopId);
  const ref = shop.collection("procedureMonths").doc(month);
  return db.runTransaction(async transaction => {
    const [shopSnapshot, snapshot] = await Promise.all([transaction.get(shop), transaction.get(ref)]);
    if (!shopSnapshot.exists) throw new Error("notFound");
    const existing = snapshot.exists ? procedureSummarySchema.parse(snapshot.data()) : null;
    if (existing?.totalMixMax !== undefined && existing.userTotals !== undefined) return existing;
    const summary = { ...existing, ...EMPTY_PROCEDURE_SUMMARY, revision: existing?.revision ?? 0 };
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

// Build derived single-field indexes in bounded transactions. Business revisions stay unchanged.
async function ensureProcedureRecordIndexes(shopId: string, month: string, userRoster?: SalesRepresentative[]) {
  const shop = db.collection("shops").doc(shopId);
  const ref = shop.collection("procedureMonths").doc(month);
  const rosterHash = userRoster === undefined ? undefined : procedureUserRosterHash(userRoster);
  let cursor: string | undefined;
  while (true) {
    const result: { done: boolean; cursor?: string } = await db.runTransaction(async transaction => {
      const [shopSnapshot, snapshot] = await Promise.all([transaction.get(shop), transaction.get(ref)]);
      if (!shopSnapshot.exists) throw new Error("notFound");
      const representatives = rosterHash === undefined ? [] : getMonthlyRepresentatives(shopSchema.parse({ ...shopSnapshot.data(), id: shopSnapshot.id }), month);
      // Reading the shop also makes each batch retry if its roster changes during the transaction.
      if (rosterHash !== undefined && procedureUserRosterHash(representatives) !== rosterHash) throw new Error("conflict");
      const summary = snapshot.exists ? procedureSummarySchema.parse(snapshot.data()) : { ...EMPTY_PROCEDURE_SUMMARY };
      if (summary.filterIndexVersion === 1 && (rosterHash === undefined || (summary.userSortIndexVersion === 1 && summary.userFilterIndexVersion === 1 && summary.userNameIndexRosterHash === rosterHash))) return { done: true };
      let query = ref.collection("records").orderBy(documentId()).limit(200);
      if (cursor) query = query.startAfter(cursor);
      const records = await transaction.get(query);
      for (const record of records.docs) {
        const entry = procedureRecordSchema.parse({ ...record.data(), id: record.id });
        if (entry.month !== month) throw new Error("invalidData");
        const projection = { productStatus: procedureProductStatus(entry), ...(rosterHash !== undefined ? procedureUserIndexes(entry, representatives) : {}) };
        if (Object.entries(projection).some(([key, value]) => entry[key as keyof ProcedureRecord] !== value)) transaction.update(record.ref, projection);
      }
      const done = records.size < 200;
      if (done && snapshot.exists) transaction.set(ref, procedureSummarySchema.parse({ ...summary, filterIndexVersion: 1, ...(rosterHash !== undefined ? { userSortIndexVersion: 1, userFilterIndexVersion: 1, userNameIndexRosterHash: rosterHash } : {}) }));
      return { done, cursor: records.docs.at(-1)?.id };
    });
    if (result.done) return;
    cursor = result.cursor;
  }
}

export async function loadProcedures(shopId: string, month: string, cursor?: string, inputFilter: ProcedureFilter = {}, inputSort: ProcedureSort = "source"): Promise<ProceduresPage> {
  shopIdSchema.parse(shopId); attendanceMonthSchema.parse(month);
  const validFilter = procedureFilterSchema.parse(inputFilter);
  const sort = procedureSortSchema.parse(inputSort);
  await requireShopAccess(shopId);
  const shop = db.collection("shops").doc(shopId);
  const ref = shop.collection("procedureMonths").doc(month);
  const [summary, shopSnapshot] = await Promise.all([ensureProductSummary(shopId, month), shop.get()]);
  if (!shopSnapshot.exists) throw new Error("notFound");
  const representatives = getMonthlyRepresentatives(shopSchema.parse({ ...shopSnapshot.data(), id: shopSnapshot.id }), month);
  const rosterHash = procedureUserRosterHash(representatives);
  const filter = validFilter.user === undefined ? validFilter : { ...validFilter, user: resolveProcedureUserName(validFilter.user, representatives) };
  const useUserOrder = sort !== "source" || filter.user !== undefined;
  const cursorValue = cursor === undefined ? undefined : useUserOrder ? decodeSortedProcedureCursor(cursor, shopId, month, filter, sort) : procedureCursorSchema.parse(cursor);
  if (useUserOrder || (filter.product && filter.status)) await ensureProcedureRecordIndexes(shopId, month, useUserOrder ? representatives : undefined);
  let query = ref.collection("records").orderBy(documentId());
  const orderScope = procedureUserOrderScope(filter);
  if (useUserOrder) query = ref.collection("records").where(orderScope.field, ">=", orderScope.prefix).where(orderScope.field, "<", orderScope.end).orderBy(orderScope.field, sort === "userDesc" ? "desc" : "asc");
  else if (filter.product && filter.status) query = query.where("productStatus", "==", procedureProductStatus({ product: filter.product, status: filter.status }));
  else if (filter.product) query = query.where("product", "==", filter.product);
  else if (filter.status) query = query.where("status", "==", filter.status);
  if (cursorValue) query = query.startAfter(cursorValue);
  const [currentShopSnapshot, records] = await Promise.all([shop.get(), query.limit(51).get()]);
  if (!currentShopSnapshot.exists) throw new Error("notFound");
  const currentRepresentatives = getMonthlyRepresentatives(shopSchema.parse({ ...currentShopSnapshot.data(), id: currentShopSnapshot.id }), month);
  if (useUserOrder && procedureUserRosterHash(currentRepresentatives) !== rosterHash) throw new Error("conflict");
  const items = records.docs.slice(0, 50).map(record => procedureRecordSchema.parse({ ...record.data(), id: record.id }));
  if (items.some(item => item.month !== month)) throw new Error("invalidData");
  if (items.some(item => (filter.product && item.product !== filter.product) || (filter.status && item.status !== filter.status)
    || (filter.user !== undefined && resolveProcedureUserName(item.user, currentRepresentatives) !== filter.user))) throw new Error("invalidData");
  if (useUserOrder && items.some(item => item[orderScope.field] !== procedureUserIndexes(item, currentRepresentatives)[orderScope.field])) throw new Error("invalidData");
  const lastItem = items.at(-1);
  const nextCursor = records.size <= 50 || !lastItem ? null : useUserOrder ? encodeSortedProcedureCursor(lastItem[orderScope.field]!, shopId, month, filter, sort) : lastItem.id;
  const groupedSummary = procedureSummarySchema.parse({ ...summary, userTotals: groupProcedureUserTotals(summary.userTotals ?? [], currentRepresentatives) });
  return { items, summary: groupedSummary, representatives: currentRepresentatives, nextCursor };
}

export async function saveProcedures(input: z.infer<typeof saveProceduresSchema>) {
  const value = saveProceduresSchema.parse(input);
  const actor = await requireEditorForShops([value.shopId]);
  await ensureProductSummary(value.shopId, value.month);
  // New entries must belong to the selected month. Imported dates may be retained when editing.
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
    const representatives = getMonthlyRepresentatives(shopData, value.month);
    const records = changes.map((change, index) => {
      const existing = snapshots[index].exists ? procedureRecordSchema.parse({ ...snapshots[index].data(), id: change.id }) : null;
      if (snapshots[index + changes.length].exists) throw new Error("conflict");
      if ((existing?.revision ?? 0) !== change.expectedRevision) throw new Error("conflict");
      if (!existing && (change.id.startsWith("0-") || !change.fields.dateTime.startsWith(`${value.month}-`))) throw new Error("invalidData");
      const representative = representatives.find(item => item.id === change.representativeId);
      if ((!existing || change.representativeId !== undefined) && !representative) throw new Error("representativeRequired");
      const fields = representative ? { ...change.fields, user: representative.name } : change.fields;
      if (existing) adjustProcedureSummary(summary, existing, -1);
      const record = procedureRecordSchema.parse({ ...fields, productStatus: procedureProductStatus(fields), ...procedureUserIndexes({ ...fields, id: change.id }, representatives), id: change.id, month: value.month, revision: (existing?.revision ?? 0) + 1,
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
    const representatives = getMonthlyRepresentatives(shopSchema.parse({ ...shopSnapshot.data(), id: shopSnapshot.id }), value.month);
    const records = value.records.map((target, index) => {
      if (!snapshots[index].exists || snapshots[index + value.records.length].exists) throw new Error("conflict");
      const deleted = deletedProcedureSchema.parse({ ...snapshots[index].data(), id: target.id });
      if (deleted.month !== value.month) throw new Error("invalidData");
      if (deleted.revision !== target.expectedRevision) throw new Error("conflict");
      const original = procedureRecordSchema.strip().parse(deleted);
      const record = procedureRecordSchema.parse({ ...original, productStatus: procedureProductStatus(original), ...procedureUserIndexes(original, representatives), revision: original.revision + 1, updatedAt: now, updatedBy: actor.id });
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
    const representatives = getMonthlyRepresentatives(shopSchema.parse({ ...shopSnapshot.data(), id: shopSnapshot.id }), value.month);
    if (summary.revision !== value.expectedRevision) throw new Error("conflict");
    for (const row of validRows) {
      const id = `0-${fileHash}-${String(row.row).padStart(6, "0")}`;
      const record = procedureRecordSchema.parse({ ...row.fields, productStatus: procedureProductStatus(row.fields), ...procedureUserIndexes({ ...row.fields, id }, representatives), id, month: value.month, revision: 1,
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
