"use server";

import { collection, getDocs, orderBy, query, where } from "@/lib/firebase-admin";
import { getCurrentActor, requireShopAccess } from "@/lib/access";
import { loadAccessibleShops, loadShopDirectory } from "@/lib/shop-directory";
import { monthSchema, performanceDataSchema, shopIdSchema } from "@/lib/persistence-schemas";
import { loadPerformanceIndex } from "@/lib/performance-index";
import { type PerformanceData, type PerformanceIndexEntry, type Shop, type ShopData } from "@/lib/types";
import { adminDb as db } from "@/lib/firebase-admin";

export async function fetchShops(): Promise<Shop[]> {
  const actor = await getCurrentActor();
  return loadAccessibleShops(actor);
}

export async function fetchShopPerformanceForMonth(shopId: string, month: string): Promise<PerformanceData[]> {
  const validShopId = shopIdSchema.parse(shopId);
  const validMonth = monthSchema.parse(month);
  await requireShopAccess(validShopId);
  const snapshot = await getDocs(query(
    collection(db, "shops", validShopId, "performance"),
    where("date", ">=", `${validMonth}-01`),
    where("date", "<=", `${validMonth}-31`),
    orderBy("date", "asc"),
  ));
  return snapshot.docs.flatMap(document => {
    const result = performanceDataSchema.safeParse({ id: document.id, ...document.data() });
    if (result.success) return [result.data as unknown as PerformanceData];
    console.error(`Ignoring invalid performance document ${document.ref.path}:`, result.error.flatten());
    return [];
  });
}

export async function fetchShopPerformanceIndex(shopId: string): Promise<PerformanceIndexEntry[]> {
  const validShopId = shopIdSchema.parse(shopId);
  await requireShopAccess(validShopId);
  return loadPerformanceIndex(validShopId);
}

export async function fetchShopData(): Promise<ShopData> {
  const actor = await getCurrentActor();
  return loadShopDirectory(actor);
}
