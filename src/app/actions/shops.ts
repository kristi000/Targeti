"use server";

import { addDoc, collection, doc, documentId, getDocs, limit, query, updateDoc, where, writeBatch } from "@/lib/firebase-admin";
import { requireAdmin, requireEditorForShops } from "@/lib/access";
import { refreshDashboardSummaries } from "@/app/dashboard-actions";
import { newShopSchema, shopIdSchema, shopSchema } from "@/lib/persistence-schemas";
import { getInitialTargets, type Shop } from "@/lib/types";
import { createActivity, mutationError, parseFirestoreDocument, recordActivity, toFirestoreData } from "@/app/actions/shared";
import { adminDb as db } from "@/lib/firebase-admin";
import { deleteShopAttendance } from "@/lib/server/attendance";
import { deleteShopProcedures } from "@/lib/server/procedures";

export async function handleAddShop(shopName: string, description?: string) {
  try {
    await requireAdmin();
    const input = newShopSchema.parse({ name: shopName, description });
    const monthlyTargets = getInitialTargets();
    const shopData = {
      name: input.name,
      description: input.description ?? "",
      salesRepresentatives: [],
      monthlyTargets,
      createdAt: new Date().toISOString(),
    };
    const document = await addDoc(collection(db, "shops"), toFirestoreData(shopData));
    await refreshDashboardSummaries({ shopIds: [document.id], periodsChanged: true });
    await recordActivity({ action: "shop_created", summary: `Created shop ${shopData.name}.`, shopIds: [document.id], shopNames: [shopData.name] });

    return {
      success: true as const,
      data: { id: document.id, ...shopData } satisfies Shop,
    };
  } catch (error) {
    return { success: false as const, error: mutationError("add the shop", error) };
  }
}

export async function handleAllocateShopId() {
  try {
    await requireAdmin();
    return { success: true as const, data: collection(db, "shops").doc().id };
  } catch (error) {
    return { success: false as const, error: mutationError("prepare a shop import", error) };
  }
}

export async function handleUpdateShop(shop: Shop) {
  try {
    let validShop = shopSchema.parse(shop) as Shop;
    const actor = await requireEditorForShops([validShop.id]);
    if (actor.role !== "admin") {
      const currentDocument = (await getDocs(query(collection(db, "shops"), where(documentId(), "==", validShop.id), limit(1)))).docs[0];
      const currentShop = currentDocument ? parseFirestoreDocument(shopSchema, currentDocument.id, currentDocument.data()) as Shop | null : null;
      validShop = { ...validShop, supervisorId: currentShop?.supervisorId };
    }
    const { id, ...shopData } = validShop;
    await updateDoc(doc(db, "shops", id), toFirestoreData(shopData));
    await refreshDashboardSummaries({ shopIds: [id], periodsChanged: true });
    await recordActivity({ action: "shop_edited", summary: `Edited shop ${validShop.name}.`, shopIds: [id], shopNames: [validShop.name] });
    return { success: true as const, data: validShop };
  } catch (error) {
    return { success: false as const, error: mutationError("update the shop", error) };
  }
}

export async function handleDeleteShop(shopId: string) {
  try {
    await requireAdmin();
    const validShopId = shopIdSchema.parse(shopId);
    const shopRef = doc(db, "shops", validShopId);
    const shopSnapshot = await getDocs(query(collection(db, "shops"), where(documentId(), "==", validShopId), limit(1)));
    const shopName = shopSnapshot.docs[0]?.data().name ?? validShopId;
    const [performance, bonusSnapshots, quarterlyBonusSnapshots, dailyClosings, dailyActivityMonths] = await Promise.all([
      getDocs(collection(db, "shops", validShopId, "performance")),
      getDocs(collection(db, "shops", validShopId, "bonusSnapshots")),
      getDocs(collection(db, "shops", validShopId, "quarterlyBonusSnapshots")),
      getDocs(collection(db, "shops", validShopId, "dailyClosings")),
      getDocs(collection(db, "shops", validShopId, "dailyActivityMonths")),
    ]);
    const childReferences = [
      ...performance.docs.map(item => item.ref),
      ...bonusSnapshots.docs.map(item => item.ref),
      ...quarterlyBonusSnapshots.docs.map(item => item.ref),
      ...dailyClosings.docs.map(item => item.ref),
      ...dailyActivityMonths.docs.map(item => item.ref),
    ];
    for (let start = 0; start < childReferences.length; start += 450) {
      const batch = writeBatch(db);
      childReferences.slice(start, start + 450).forEach(reference => batch.delete(reference));
      await batch.commit();
    }
    const activity = await createActivity({ action: "shop_deleted", summary: `Deleted shop ${shopName}.`, shopIds: [validShopId], shopNames: [shopName] });
    await deleteShopAttendance(validShopId);
    await deleteShopProcedures(validShopId);
    const finalBatch = writeBatch(db);
    finalBatch.delete(shopRef);
    finalBatch.set(activity.reference, activity.data);
    await finalBatch.commit();
    await refreshDashboardSummaries({ shopIds: [validShopId], performanceChanged: true, periodsChanged: true });
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: mutationError("delete the shop", error) };
  }
}
