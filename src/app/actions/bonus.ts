"use server";

import { doc, getDoc, runTransaction } from "@/lib/firebase-admin";
import { requireEditorForShops, requireShopAccess } from "@/lib/access";
import { bonusSnapshotSchema, monthSchema, shopIdSchema } from "@/lib/persistence-schemas";
import { type BonusSnapshot } from "@/lib/types";
import { mutationError, toFirestoreData } from "@/app/actions/shared";
import { adminDb as db } from "@/lib/firebase-admin";
import { requireRestrictedAccess } from "@/lib/restricted-access";

export async function saveBonusSnapshot(shopId: string, snapshot: BonusSnapshot) {
  try {
    await requireRestrictedAccess();
    await requireEditorForShops([shopId]);
    const validShopId = shopIdSchema.parse(shopId);
    const validSnapshot = bonusSnapshotSchema.parse(snapshot) as BonusSnapshot;
    const snapshotRef = doc(db, "shops", validShopId, "bonusSnapshots", validSnapshot.month);

    await runTransaction(db, async transaction => {
      if ((await transaction.get(snapshotRef)).exists) throw new Error("ALREADY_FINALIZED");
      transaction.set(snapshotRef, toFirestoreData(validSnapshot));
    });

    return { success: true as const, data: validSnapshot };
  } catch (error) {
    if (error instanceof Error && error.message === "ALREADY_FINALIZED") {
      return { success: false as const, error: "This month has already been finalized." };
    }
    return { success: false as const, error: mutationError("finalize the payroll snapshot", error) };
  }
}

export async function fetchBonusSnapshot(shopId: string, month: string): Promise<BonusSnapshot | null> {
  await requireRestrictedAccess();
  const validShopId = shopIdSchema.parse(shopId);
  await requireShopAccess(validShopId);
  const validMonth = monthSchema.parse(month);
  const snapshot = await getDoc(doc(db, "shops", validShopId, "bonusSnapshots", validMonth));
  if (!snapshot.exists) return null;
  const result = bonusSnapshotSchema.safeParse(snapshot.data());
  if (result.success) return result.data as BonusSnapshot;
  console.error(`Ignoring invalid bonus snapshot ${snapshot.ref.path}:`, result.error.flatten());
  return null;
}
