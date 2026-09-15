"use server";

import { doc, writeBatch } from "@/lib/firebase-admin";
import { requireEditorForShops } from "@/lib/access";
import { refreshDashboardSummaries } from "@/app/dashboard-actions";
import { performanceDataListSchema, shopIdSchema } from "@/lib/persistence-schemas";
import { type PerformanceData } from "@/lib/types";
import { mutationError, toFirestoreData } from "@/app/actions/shared";
import { adminDb as db } from "@/lib/firebase-admin";

async function savePerformanceData(shopId: string, data: PerformanceData[], useImportId: boolean) {
  const validShopId = shopIdSchema.parse(shopId);
  // Zod's catch-all output cannot express the mixed repId/metric index signature,
  // but the schema has validated every property before this conversion.
  const validData = performanceDataListSchema.parse(data) as unknown as PerformanceData[];
  const batch = writeBatch(db);

  validData.forEach(entry => {
    const documentId = useImportId ? entry.importId ?? entry.date : entry.date;
    batch.set(doc(db, "shops", validShopId, "performance", documentId), toFirestoreData(entry));
  });

  await batch.commit();
  await refreshDashboardSummaries({
    shopIds: [validShopId],
    months: [...new Set(validData.map(entry => entry.date.slice(0, 7)))],
  });
  return validData;
}

export async function handleSavePerformanceData(shopId: string, data: PerformanceData[]) {
  try {
    await requireEditorForShops([shopId]);
    const validData = await savePerformanceData(shopId, data, false);
    return { success: true as const, data: validData };
  } catch (error) {
    return { success: false as const, error: mutationError("save performance data", error) };
  }
}

export async function handleSaveExcelPerformanceData(shopId: string, data: PerformanceData[]) {
  try {
    await requireEditorForShops([shopId]);
    const validData = await savePerformanceData(shopId, data, true);
    return { success: true as const, data: validData };
  } catch (error) {
    return { success: false as const, error: mutationError("save Excel performance data", error) };
  }
}
