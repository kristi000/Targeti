"use server";

import { z } from "zod";
import { collection, doc, documentId, getDocs, limit, query, where, writeBatch } from "@/lib/firebase-admin";
import { requireEditorForShops } from "@/lib/access";
import { refreshDashboardSummaries } from "@/app/dashboard-actions";
import { getEqualRepresentativeTargets } from "@/lib/representative-targets";
import { performanceDataSchema, monthSchema, shopIdSchema, shopSchema } from "@/lib/persistence-schemas";
import { getOverviewPerformanceData, getShopMetrics, type PerformanceData, type Shop } from "@/lib/types";
import { mutationError, parseFirestoreDocument, recordActivity, toFirestoreData } from "@/app/actions/shared";
import { adminDb as db } from "@/lib/firebase-admin";

export async function handlePrepareRepresentativeImport(shopId: string) {
  try {
    const validShopId = shopIdSchema.parse(shopId);
    await requireEditorForShops([validShopId]);
    const shopDocument = (await getDocs(query(collection(db, "shops"), where(documentId(), "==", validShopId), limit(1)))).docs[0];
    const shop = shopDocument
      ? parseFirestoreDocument(shopSchema, shopDocument.id, shopDocument.data()) as Shop | null
      : null;
    if (!shop) throw new Error("SHOP_NOT_FOUND");

    const performanceSnapshot = await getDocs(collection(db, "shops", validShopId, "performance"));
    const performanceData = performanceSnapshot.docs.flatMap(document => {
      const parsed = parseFirestoreDocument(performanceDataSchema, document.id, document.data()) as PerformanceData | null;
      return parsed ? [parsed] : [];
    });
    const latestReport = getOverviewPerformanceData(performanceData)
      .sort((left, right) =>
        right.date.localeCompare(left.date)
        || (right.importedAt ?? right.date).localeCompare(left.importedAt ?? left.date),
      )[0];
    const latestMonth = latestReport?.date.slice(0, 7);
    const visibleRepresentatives = latestMonth
      ? shop.monthlyData?.[latestMonth]?.representatives ?? shop.salesRepresentatives ?? []
      : shop.salesRepresentatives ?? [];
    const visibleIds = new Set(visibleRepresentatives.map(representative => representative.id));
    const visibleNames = new Set(visibleRepresentatives.map(representative => representative.name.trim().toLocaleLowerCase()));
    const hiddenById = new Map((shop.hiddenSalesRepresentatives ?? []).map(representative => [representative.id, representative]));

    latestReport?.reps.forEach(representative => {
      if (
        representative.repName
        && !visibleIds.has(representative.repId)
        && !visibleNames.has(representative.repName.trim().toLocaleLowerCase())
      ) {
        hiddenById.set(representative.repId, { id: representative.repId, name: representative.repName });
      }
    });

    const hiddenSalesRepresentatives = Array.from(hiddenById.values());
    return { success: true as const, hiddenSalesRepresentatives };
  } catch (error) {
    if (error instanceof Error && error.message === "SHOP_NOT_FOUND") return { success: false as const, error: "The shop no longer exists." };
    return { success: false as const, error: mutationError("prepare hidden representatives for import", error) };
  }
}

const representativeSelectionSchema = z.object({
  month: monthSchema,
  representatives: z.array(z.object({
    shopId: shopIdSchema,
    representativeId: shopIdSchema,
    representativeName: z.string().trim().min(1).max(120).optional(),
  }).strict()).min(1).max(500),
}).strict();

export async function handleHideRepresentatives(month: string, representatives: Array<{ shopId: string; representativeId: string }>) {
  try {
    const input = representativeSelectionSchema.parse({ month, representatives });
    await requireEditorForShops([...new Set(input.representatives.map(item => item.shopId))]);
    const representativeIdsByShop = new Map<string, Set<string>>();
    input.representatives.forEach(({ shopId, representativeId }) => {
      const ids = representativeIdsByShop.get(shopId) ?? new Set<string>();
      ids.add(representativeId);
      representativeIdsByShop.set(shopId, ids);
    });

    const snapshot = await getDocs(collection(db, "shops"));
    const selectedDocuments = snapshot.docs.filter(document => representativeIdsByShop.has(document.id));
    if (selectedDocuments.length !== representativeIdsByShop.size) throw new Error("SHOP_NOT_FOUND");

    const updatedShops: Shop[] = [];
    let hiddenCount = 0;
    selectedDocuments.forEach(document => {
      const shop = parseFirestoreDocument(shopSchema, document.id, document.data()) as Shop | null;
      if (!shop) return;
      const selectedIds = representativeIdsByShop.get(shop.id)!;
      const monthData = shop.monthlyData?.[input.month];
      const currentRepresentatives = monthData?.representatives ?? shop.salesRepresentatives ?? [];
      const newlyHidden = currentRepresentatives.filter(representative => selectedIds.has(representative.id));
      const remainingRepresentatives = currentRepresentatives.filter(representative => !selectedIds.has(representative.id));
      hiddenCount += newlyHidden.length;
      const hiddenById = new Map(
        (shop.hiddenSalesRepresentatives ?? []).map(representative => [representative.id, representative]),
      );
      newlyHidden.forEach(representative => hiddenById.set(representative.id, representative));
      const baseShop: Shop = {
        ...shop,
        salesRepresentatives: (shop.salesRepresentatives ?? []).filter(representative => !selectedIds.has(representative.id)),
        hiddenSalesRepresentatives: Array.from(hiddenById.values()),
      };

      if (monthData) {
        const metrics = getShopMetrics({
          ...shop,
          metricSettings: monthData.metricSettings ?? shop.metricSettings,
          metricOrder: monthData.metricOrder ?? shop.metricOrder,
        }, monthData.targets);
        const sharedTargets = getEqualRepresentativeTargets(monthData.targets, metrics, remainingRepresentatives.length);
        updatedShops.push({
          ...baseShop,
          monthlyData: {
            ...baseShop.monthlyData,
            [input.month]: {
              ...monthData,
              representatives: remainingRepresentatives,
              representativeTargets: Object.fromEntries(remainingRepresentatives.map(representative => [representative.id, sharedTargets])),
            },
          },
        });
      } else {
        updatedShops.push({ ...baseShop, salesRepresentatives: remainingRepresentatives });
      }
    });

    if (!hiddenCount) throw new Error("REPRESENTATIVES_NOT_FOUND");
    const batch = writeBatch(db);
    updatedShops.forEach(shop => {
      const { id, ...shopData } = shopSchema.parse(shop) as Shop;
      batch.set(doc(db, "shops", id), toFirestoreData(shopData));
    });
    await batch.commit();
    await refreshDashboardSummaries({ shopIds: updatedShops.map(shop => shop.id), months: [input.month], periodsChanged: true });
    await recordActivity({
      action: "representatives_hidden",
      summary: `Hid ${hiddenCount} representative(s) in ${updatedShops.length} shop(s) for ${input.month}.`,
      shopIds: updatedShops.map(shop => shop.id),
      shopNames: updatedShops.map(shop => shop.name),
      metadata: { month: input.month, representativeCount: hiddenCount, shopCount: updatedShops.length },
    });
    return { success: true as const, count: hiddenCount, shops: updatedShops.length };
  } catch (error) {
    if (error instanceof Error && error.message === "SHOP_NOT_FOUND") return { success: false as const, error: "One or more shops no longer exist." };
    if (error instanceof Error && error.message === "REPRESENTATIVES_NOT_FOUND") return { success: false as const, error: "The selected representatives no longer exist in this reporting month." };
    return { success: false as const, error: mutationError("hide the selected representatives", error) };
  }
}

export async function handleUnhideRepresentatives(month: string, representatives: Array<{ shopId: string; representativeId: string; representativeName: string }>) {
  try {
    const input = representativeSelectionSchema.parse({ month, representatives });
    await requireEditorForShops([...new Set(input.representatives.map(item => item.shopId))]);
    const representativesByShop = new Map<string, Array<{ id: string; name: string }>>();
    input.representatives.forEach(({ shopId, representativeId, representativeName }) => {
      if (!representativeName) return;
      const values = representativesByShop.get(shopId) ?? [];
      if (!values.some(representative => representative.id === representativeId)) {
        values.push({ id: representativeId, name: representativeName });
      }
      representativesByShop.set(shopId, values);
    });

    const snapshot = await getDocs(collection(db, "shops"));
    const selectedDocuments = snapshot.docs.filter(document => representativesByShop.has(document.id));
    if (selectedDocuments.length !== representativesByShop.size) throw new Error("SHOP_NOT_FOUND");

    const updatedShops: Shop[] = [];
    let unhiddenCount = 0;
    selectedDocuments.forEach(document => {
      const shop = parseFirestoreDocument(shopSchema, document.id, document.data()) as Shop | null;
      if (!shop) return;
      const restored = representativesByShop.get(shop.id) ?? [];
      const restoredIds = new Set(restored.map(representative => representative.id));
      const restoredNames = new Set(restored.map(representative => representative.name.trim().toLocaleLowerCase()));
      const monthData = shop.monthlyData?.[input.month];
      const currentRepresentatives = monthData?.representatives ?? shop.salesRepresentatives ?? [];
      const nextRepresentatives = [
        ...currentRepresentatives,
        ...restored.filter(representative => !currentRepresentatives.some(current => current.id === representative.id)),
      ];
      const nextSalesRepresentatives = [
        ...(shop.salesRepresentatives ?? []),
        ...restored.filter(representative => !(shop.salesRepresentatives ?? []).some(current => current.id === representative.id)),
      ];
      const baseShop: Shop = {
        ...shop,
        salesRepresentatives: nextSalesRepresentatives,
        hiddenSalesRepresentatives: (shop.hiddenSalesRepresentatives ?? [])
          .filter(representative =>
            !restoredIds.has(representative.id)
            && !restoredNames.has(representative.name.trim().toLocaleLowerCase()),
          ),
      };

      if (monthData) {
        const metrics = getShopMetrics({
          ...shop,
          metricSettings: monthData.metricSettings ?? shop.metricSettings,
          metricOrder: monthData.metricOrder ?? shop.metricOrder,
        }, monthData.targets);
        const sharedTargets = getEqualRepresentativeTargets(monthData.targets, metrics, nextRepresentatives.length);
        updatedShops.push({
          ...baseShop,
          monthlyData: {
            ...baseShop.monthlyData,
            [input.month]: {
              ...monthData,
              representatives: nextRepresentatives,
              representativeTargets: Object.fromEntries(nextRepresentatives.map(representative => [representative.id, sharedTargets])),
            },
          },
        });
      } else {
        updatedShops.push(baseShop);
      }
      unhiddenCount += restored.length;
    });

    if (!unhiddenCount) throw new Error("REPRESENTATIVES_NOT_FOUND");
    const batch = writeBatch(db);
    updatedShops.forEach(shop => {
      const { id, ...shopData } = shopSchema.parse(shop) as Shop;
      batch.set(doc(db, "shops", id), toFirestoreData(shopData));
    });
    await batch.commit();
    await refreshDashboardSummaries({ shopIds: updatedShops.map(shop => shop.id), months: [input.month], periodsChanged: true });
    await recordActivity({
      action: "representatives_unhidden",
      summary: `Unhid ${unhiddenCount} representative(s) in ${updatedShops.length} shop(s) for ${input.month}.`,
      shopIds: updatedShops.map(shop => shop.id),
      shopNames: updatedShops.map(shop => shop.name),
      metadata: { month: input.month, representativeCount: unhiddenCount, shopCount: updatedShops.length },
    });
    return { success: true as const, count: unhiddenCount, shops: updatedShops.length };
  } catch (error) {
    if (error instanceof Error && error.message === "SHOP_NOT_FOUND") return { success: false as const, error: "One or more shops no longer exist." };
    if (error instanceof Error && error.message === "REPRESENTATIVES_NOT_FOUND") return { success: false as const, error: "The selected hidden representatives no longer exist." };
    return { success: false as const, error: mutationError("unhide the selected representatives", error) };
  }
}
