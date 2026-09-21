"use server";

import { z } from "zod";
import type { ImportHistoryItem } from "@/lib/import-history";
import { collection, deleteField, doc, documentId, getDocs, limit, orderBy, query, startAfter, where, writeBatch } from "@/lib/firebase-admin";
import { getCurrentActor, requireAdmin, requireEditor, requireEditorForShops } from "@/lib/access";
import { refreshDashboardSummaries } from "@/app/dashboard-actions";
import { performanceDataSchema, isoDateSchema, monthSchema, shopIdSchema, shopSchema } from "@/lib/persistence-schemas";
import { type PerformanceData, type Shop } from "@/lib/types";
import { createActivity, mutationError, omitId, parseFirestoreDocument, stableValue, toFirestoreData } from "@/app/actions/shared";
import { adminDb as db } from "@/lib/firebase-admin";

const importChangeSchema = z.object({
  shopId: shopIdSchema,
  shopName: z.string().trim().min(1).max(120),
  performanceId: shopIdSchema,
  previousShop: shopSchema.nullable(),
  importedShop: shopSchema,
}).strict();

const importStatusSchema = z.enum(["active", "superseded", "undone", "removed"]);

const importCommitChangeSchema = importChangeSchema.extend({
  performance: performanceDataSchema,
}).superRefine((change, context) => {
  if (change.shopId !== change.importedShop.id) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Imported shop ID does not match the target shop." });
  }
  if (change.performanceId !== change.performance.importId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Performance import ID does not match the import." });
  }
});

export async function handleRegisterImport(importId: string, fileName: string, month: string, reportDate: string, changes: Array<{ shopId: string; shopName: string; performanceId: string; previousShop: Shop | null; importedShop: Shop; performance: PerformanceData }>) {
  try {
    await requireEditor();
    const validImportId = shopIdSchema.parse(importId);
    const validFileName = z.string().trim().min(1).max(255).parse(fileName);
    const validMonth = monthSchema.parse(month);
    const validReportDate = isoDateSchema.parse(reportDate);
    if (!validReportDate.startsWith(validMonth)) throw new Error("The reporting date must be within the reporting month.");
    const validChanges = z.array(importCommitChangeSchema).min(1).max(150).parse(changes) as unknown as typeof changes;
    await requireEditorForShops(validChanges.map(change => change.shopId));
    if (validChanges.some(change => change.performance.importId !== validImportId || !change.performance.date.startsWith(validMonth))) {
      throw new Error("Every performance record must belong to the selected import and reporting month.");
    }
    const existingMonthImports = await getDocs(query(collection(db, "imports"), where("month", "==", validMonth)));
    const activeImports = existingMonthImports.docs.filter(document =>
      document.id !== validImportId && document.data().status === "active"
    );
    const writeCount = 2 + (validChanges.length * 3) + activeImports.length;
    if (writeCount > 500) {
      throw new Error("This month has too many active import versions to replace in one operation. Clean up its import history and try again.");
    }
    const value = {
      fileName: validFileName,
      month: validMonth,
      reportDate: validReportDate,
      shopIds: validChanges.map(change => change.shopId),
      createdAt: new Date().toISOString(),
      actor: await getCurrentActor(),
      status: "active",
      recordCount: validChanges.length,
    };
    const activity = await createActivity({
      action: "excel_imported",
      summary: `Imported ${validFileName} for ${validChanges.length} shop(s).`,
      shopIds: validChanges.map(change => change.shopId),
      shopNames: validChanges.map(change => change.shopName),
      metadata: { importId: validImportId, month: validMonth, recordCount: validChanges.length },
    }, value.actor);
    const batch = writeBatch(db);
    batch.set(doc(db, "imports", validImportId), toFirestoreData(value));
    activeImports.forEach(document => batch.update(document.ref, {
      status: "superseded",
      supersededAt: value.createdAt,
      supersededBy: validImportId,
    }));
    validChanges.forEach(change => {
      const shopData = Object.fromEntries(Object.entries(change.importedShop).filter(([key]) => key !== "id"));
      const performanceData = Object.fromEntries(Object.entries(change.performance).filter(([key]) => key !== "id"));
      const historyChange = Object.fromEntries(Object.entries(change).filter(([key]) => key !== "performance"));
      batch.set(doc(db, "shops", change.shopId), toFirestoreData(shopData));
      batch.set(doc(db, "shops", change.shopId, "performance", change.performanceId), toFirestoreData(performanceData));
      batch.set(doc(db, "imports", validImportId, "changes", change.shopId), toFirestoreData(historyChange));
    });
    batch.set(activity.reference, activity.data);
    await batch.commit();
    await refreshDashboardSummaries({ shopIds: validChanges.map(change => change.shopId), months: [validMonth], performanceChanged: true, periodsChanged: true });
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: mutationError("register the Excel import", error) };
  }
}

const importHistoryCursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: shopIdSchema }).optional();

export async function fetchImportHistoryPage(cursor?: { createdAt: string; id: string }) {
  await requireAdmin();
  const validCursor = importHistoryCursorSchema.parse(cursor);
  const constraints = [orderBy("createdAt", "desc"), orderBy(documentId(), "desc"), ...(validCursor ? [startAfter(validCursor.createdAt, validCursor.id)] : []), limit(21)];
  const snapshot = await getDocs(query(collection(db, "imports"), ...constraints));
  const hasMore = snapshot.docs.length > 20;
  const documents = snapshot.docs.slice(0, 20);
  const imports = documents.flatMap(document => {
    const data = document.data();
    const parsed = z.object({
      fileName: z.string().trim().min(1).max(255),
      month: monthSchema,
      createdAt: z.string().datetime({ offset: true }),
      actor: z.object({ name: z.string().trim().min(1).max(120) }).passthrough(),
      status: importStatusSchema,
      recordCount: z.number().int().nonnegative(),
      undoneAt: z.string().datetime({ offset: true }).optional(),
    }).safeParse(data);
    if (!parsed.success) return [];
    return [{
      id: document.id,
      fileName: parsed.data.fileName,
      month: parsed.data.month,
      createdAt: parsed.data.createdAt,
      actorName: parsed.data.actor.name,
      status: parsed.data.status,
      recordCount: parsed.data.recordCount,
      undoneAt: parsed.data.undoneAt,
    } satisfies ImportHistoryItem];
  });
  const last = documents.at(-1);
  return {
    imports,
    nextCursor: hasMore && last ? { createdAt: String(last.data().createdAt), id: last.id } : null,
  };
}

async function undoImport(importDocument: (Awaited<ReturnType<typeof getDocs>>)["docs"][number]) {
    const data = importDocument.data() as Record<string, unknown>;
    const changeSnapshot = await getDocs(collection(db, "imports", importDocument.id, "changes"));
    const changes = z.array(importChangeSchema).min(1).max(150).parse(changeSnapshot.docs.map(document => document.data())) as Array<z.infer<typeof importChangeSchema>>;
    await requireEditorForShops(changes.map(change => change.shopId));
    const currentShops = await Promise.all(changes.map(change => getDocs(query(collection(db, "shops"), where(documentId(), "==", change.shopId), limit(1)))));
    const changedAfterImport = changes.some((change, index) => {
      const currentDocument = currentShops[index].docs[0];
      if (!currentDocument) return true;
      const current = parseFirestoreDocument(shopSchema, currentDocument.id, currentDocument.data());
      return JSON.stringify(stableValue(toFirestoreData(current))) !== JSON.stringify(stableValue(toFirestoreData(change.importedShop)));
    });
    if (changedAfterImport) throw new Error("CHANGED_AFTER_IMPORT");
    const actor = await getCurrentActor();
    const month = monthSchema.parse(data.month);
    const importedAt = String(data.createdAt ?? "");
    const monthImports = await getDocs(query(collection(db, "imports"), where("month", "==", month)));
    const previousImport = monthImports.docs
      .filter(document => document.id !== importDocument.id
        && document.data().status === "superseded"
        && String(document.data().createdAt ?? "") < importedAt)
      .sort((left, right) => String(right.data().createdAt ?? "").localeCompare(String(left.data().createdAt ?? "")))[0];
    const activity = await createActivity({
      action: "excel_import_undone",
      summary: `Undid import ${String(data.fileName ?? importDocument.id)}.`,
      shopIds: changes.map(change => change.shopId),
      shopNames: changes.map(change => change.shopName),
      metadata: { importId: importDocument.id, month },
    }, actor);
    const batch = writeBatch(db);
    changes.forEach(change => {
      const shopRef = doc(db, "shops", change.shopId);
      batch.delete(doc(db, "shops", change.shopId, "performance", change.performanceId));
      if (change.previousShop) {
        const previousData = omitId(change.previousShop);
        batch.set(shopRef, toFirestoreData(previousData));
      } else {
        batch.delete(shopRef);
      }
    });
    batch.update(importDocument.ref, { status: "undone", undoneAt: new Date().toISOString(), undoneBy: actor });
    if (previousImport) {
      batch.update(previousImport.ref, {
        status: "active",
        supersededAt: deleteField(),
        supersededBy: deleteField(),
      });
    }
    batch.set(activity.reference, activity.data);
    await batch.commit();
    await refreshDashboardSummaries({ shopIds: changes.map(change => change.shopId), months: [month], performanceChanged: true, periodsChanged: true });
    return { success: true as const, fileName: String(data.fileName ?? "Excel import") };
}

export async function handleUndoImport(importId: string) {
  try {
    await requireAdmin();
    const validImportId = shopIdSchema.parse(importId);
    const snapshot = await getDocs(query(collection(db, "imports"), where("status", "==", "active"), orderBy("createdAt", "desc"), limit(1)));
    const importDocument = snapshot.docs[0];
    if (!importDocument) throw new Error("NO_IMPORT");
    if (importDocument.id !== validImportId) throw new Error("NEWER_IMPORT_EXISTS");
    return await undoImport(importDocument);
  } catch (error) {
    if (error instanceof Error && error.message === "NO_IMPORT") return { success: false as const, error: "There is no active import to undo." };
    if (error instanceof Error && error.message === "NEWER_IMPORT_EXISTS") return { success: false as const, error: "Undo newer active imports first to preserve import order." };
    if (error instanceof Error && error.message === "CHANGED_AFTER_IMPORT") return { success: false as const, error: "The latest import cannot be undone because one or more affected shops changed afterward." };
    return { success: false as const, error: mutationError("undo the latest Excel import", error) };
  }
}

export async function handleRemoveImport(importId: string) {
  try {
    await requireAdmin();
    const validImportId = shopIdSchema.parse(importId);
    const importSnapshot = await getDocs(query(collection(db, "imports"), where(documentId(), "==", validImportId), limit(1)));
    const importDocument = importSnapshot.docs[0];
    if (!importDocument || importDocument.data().status !== "active") throw new Error("NO_IMPORT");
    const data = importDocument.data();
    const month = monthSchema.parse(data.month);
    const changeSnapshot = await getDocs(collection(db, "imports", importDocument.id, "changes"));
    const changes = z.array(importChangeSchema).min(1).max(150).parse(changeSnapshot.docs.map(document => document.data())) as Array<z.infer<typeof importChangeSchema>>;
    await requireEditorForShops(changes.map(change => change.shopId));

    const currentVersionChecks = await Promise.all(changes.map(async change => {
      const performance = await getDocs(query(
        collection(db, "shops", change.shopId, "performance"),
        where("date", ">=", `${month}-01`),
        where("date", "<=", `${month}-31`),
        orderBy("date", "asc"),
      ));
      const latest = performance.docs.flatMap(document => {
        const parsed = performanceDataSchema.safeParse({ id: document.id, ...document.data() });
        return parsed.success && parsed.data.importId && parsed.data.date.startsWith(month) ? [parsed.data] : [];
      }).sort((left, right) => (right.importedAt ?? right.date).localeCompare(left.importedAt ?? left.date))[0];
      return latest?.importId === validImportId;
    }));
    const currentVersionCount = currentVersionChecks.filter(Boolean).length;

    if (currentVersionCount === changes.length) return await undoImport(importDocument);
    if (currentVersionCount > 0) throw new Error("PARTIALLY_CURRENT");

    const actor = await getCurrentActor();
    const activity = await createActivity({
      action: "excel_import_removed",
      summary: `Removed stored import ${String(data.fileName ?? importDocument.id)}.`,
      shopIds: changes.map(change => change.shopId),
      shopNames: changes.map(change => change.shopName),
      metadata: { importId: importDocument.id, month, recordCount: changes.length },
    }, actor);
    const batch = writeBatch(db);
    changes.forEach(change => batch.delete(doc(db, "shops", change.shopId, "performance", change.performanceId)));
    batch.update(importDocument.ref, { status: "removed", removedAt: new Date().toISOString(), removedBy: actor });
    batch.set(activity.reference, activity.data);
    await batch.commit();
    await refreshDashboardSummaries({ shopIds: changes.map(change => change.shopId), months: [month], performanceChanged: true, periodsChanged: true });
    return { success: true as const, fileName: String(data.fileName ?? "Excel import"), restoredShopData: false };
  } catch (error) {
    if (error instanceof Error && error.message === "NO_IMPORT") return { success: false as const, error: "This import has already been removed or no longer exists." };
    if (error instanceof Error && error.message === "PARTIALLY_CURRENT") return { success: false as const, error: "This file is current for only some affected shops. Remove newer overlapping imports first." };
    if (error instanceof Error && error.message === "CHANGED_AFTER_IMPORT") return { success: false as const, error: "This import cannot be removed because one or more affected shops were edited afterward." };
    return { success: false as const, error: mutationError("remove the Excel import", error) };
  }
}

export async function handleUndoLatestImport() {
  try {
    await requireEditor();
    const snapshot = await getDocs(query(collection(db, "imports"), where("status", "==", "active"), orderBy("createdAt", "desc"), limit(1)));
    const importDocument = snapshot.docs[0];
    if (!importDocument) throw new Error("NO_IMPORT");
    return await undoImport(importDocument);
  } catch (error) {
    if (error instanceof Error && error.message === "NO_IMPORT") return { success: false as const, error: "There is no active import to undo." };
    if (error instanceof Error && error.message === "CHANGED_AFTER_IMPORT") return { success: false as const, error: "The latest import cannot be undone because one or more affected shops changed afterward." };
    return { success: false as const, error: mutationError("undo the latest Excel import", error) };
  }
}
