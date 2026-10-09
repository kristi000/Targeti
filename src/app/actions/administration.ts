"use server";

import { collection, getDocs, writeBatch, type DocumentReference } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/access";
import { refreshDashboardSummaries } from "@/app/dashboard-actions";
import { mutationError, recordActivity } from "@/app/actions/shared";
import { adminDb as db } from "@/lib/firebase-admin";
import { deleteShopAttendance } from "@/lib/server/attendance";
import { deleteShopProcedures } from "@/lib/server/procedures";

export async function handleClearAllData() {
  try {
    await requireAdmin();
    const [shops, supervisors] = await Promise.all([
      getDocs(collection(db, "shops")),
      getDocs(collection(db, "supervisors")),
    ]);
    const references: DocumentReference[] = supervisors.docs.map(document => document.ref);
    await Promise.all(shops.docs.map(async shop => {
      await deleteShopAttendance(shop.id);
      await deleteShopProcedures(shop.id);
      const [performance, bonusSnapshots, quarterlyBonusSnapshots, dailyClosings, dailyActivityMonths] = await Promise.all([
        getDocs(collection(db, "shops", shop.id, "performance")),
        getDocs(collection(db, "shops", shop.id, "bonusSnapshots")),
        getDocs(collection(db, "shops", shop.id, "quarterlyBonusSnapshots")),
        getDocs(collection(db, "shops", shop.id, "dailyClosings")),
        getDocs(collection(db, "shops", shop.id, "dailyActivityMonths")),
      ]);
      references.push(...performance.docs.map(item => item.ref));
      references.push(...bonusSnapshots.docs.map(item => item.ref));
      references.push(...quarterlyBonusSnapshots.docs.map(item => item.ref));
      references.push(...dailyClosings.docs.map(item => item.ref));
      references.push(...dailyActivityMonths.docs.map(item => item.ref));
      references.push(shop.ref);
    }));
    for (let start = 0; start < references.length; start += 450) {
      const batch = writeBatch(db);
      references.slice(start, start + 450).forEach(reference => batch.delete(reference));
      await batch.commit();
    }
    if (!shops.empty) await refreshDashboardSummaries({ shopIds: shops.docs.map(document => document.id), performanceChanged: true, periodsChanged: true, importsChanged: true });
    await recordActivity({ action: "all_data_deleted", summary: `Deleted all application data (${shops.size} shops).`, shopIds: shops.docs.map(item => item.id), shopNames: shops.docs.map(item => String(item.data().name ?? item.id)), metadata: { shopCount: shops.size } });
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: mutationError("clear application data", error) };
  }
}
