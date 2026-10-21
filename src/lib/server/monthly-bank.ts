import "server-only";

import type { z } from "zod";
import { adminDb as db } from "@/lib/firebase-admin";
import { requireEditorForShops, requireShopAccess } from "@/lib/access";
import { requireRestrictedAccess } from "@/lib/restricted-access";
import {
  attendanceMonthSchema, monthlyBankDocumentSchema, monthlyBankReconciliationSchema,
  shopIdSchema,
} from "@/lib/persistence-schemas";
import { emptyMonthlyBankReconciliation, saveMonthlyBankReconciliationSchema, type MonthlyBankReconciliation } from "@/lib/monthly-bank";
import { createActivity, toFirestoreData } from "@/app/actions/shared";

export const saveMonthlyBankSchema = saveMonthlyBankReconciliationSchema;

export async function loadMonthlyBankReconciliation(shopId: string, month: string) {
  shopIdSchema.parse(shopId);
  attendanceMonthSchema.parse(month);
  await requireRestrictedAccess();
  const actor = await requireShopAccess(shopId);
  const shop = db.collection("shops").doc(shopId);
  const [shopSnapshot, snapshot] = await Promise.all([
    shop.get(), shop.collection("bankReconciliations").doc(month).get(),
  ]);
  if (!shopSnapshot.exists) throw new Error("SHOP_NOT_FOUND");
  const stored = snapshot.exists ? monthlyBankDocumentSchema.parse(snapshot.data()) : null;
  if (stored && stored.month !== month) throw new Error("INVALID_BANK_RECONCILIATION");
  const data = stored ? monthlyBankReconciliationSchema.parse({
    revision: stored.revision, deposits: stored.deposits, carryover: stored.carryover, carryoverNote: stored.carryoverNote,
  }) : emptyMonthlyBankReconciliation();
  return { ...data, canEdit: actor.role !== "viewer" };
}

export async function saveMonthlyBank(input: z.infer<typeof saveMonthlyBankSchema>) {
  const value = saveMonthlyBankSchema.parse(input);
  await requireRestrictedAccess();
  const actor = await requireEditorForShops([value.shopId]);
  const shopRef = db.collection("shops").doc(value.shopId);
  const reference = shopRef.collection("bankReconciliations").doc(value.month);
  const activity = await createActivity({
    action: "bank_reconciliation_saved", summary: `Updated bank reconciliation for ${value.month}.`,
    shopIds: [value.shopId], shopNames: [], metadata: { month: value.month, depositCount: value.deposits.length },
  }, actor);
  const data = await db.runTransaction(async transaction => {
    const [shopSnapshot, snapshot] = await Promise.all([transaction.get(shopRef), transaction.get(reference)]);
    if (!shopSnapshot.exists) throw new Error("SHOP_NOT_FOUND");
    const existing = snapshot.exists ? monthlyBankDocumentSchema.parse(snapshot.data()) : null;
    if (existing && existing.month !== value.month) throw new Error("INVALID_BANK_RECONCILIATION");
    if ((existing?.revision ?? 0) !== value.expectedRevision) throw new Error("conflict");
    const saved = monthlyBankDocumentSchema.parse({
      month: value.month, revision: value.expectedRevision + 1,
      deposits: value.deposits, carryover: value.carryover, carryoverNote: value.carryoverNote,
      updatedAt: new Date().toISOString(), updatedBy: actor.id,
    });
    transaction.set(reference, toFirestoreData(saved));
    transaction.set(activity.reference, activity.data);
    return { revision: saved.revision, deposits: saved.deposits, carryover: saved.carryover, carryoverNote: saved.carryoverNote } satisfies MonthlyBankReconciliation;
  });
  return { ...data, canEdit: true };
}
