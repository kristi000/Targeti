"use server";

import { collection, getDocs } from "@/lib/firebase-admin";
import { getCurrentActor, requireShopAccess } from "@/lib/access";
import { loadShopDirectory, loadShops } from "@/lib/shop-directory";
import { performanceDataSchema, shopIdSchema } from "@/lib/persistence-schemas";
import { type PerformanceData, type Shop, type ShopData } from "@/lib/types";
import { adminDb as db } from "@/lib/firebase-admin";

export async function fetchShops(): Promise<Shop[]> {
  const actor = await getCurrentActor();
  const shops = await loadShops();
  return actor.role === "admin" ? shops : shops.filter(shop => actor.shopIds.includes(shop.id));
}

export async function fetchPerformanceData(shopId: string): Promise<PerformanceData[]> {
  const validShopId = shopIdSchema.parse(shopId);
  await requireShopAccess(validShopId);
  const snapshot = await getDocs(collection(db, "shops", validShopId, "performance"));
  return snapshot.docs.flatMap(document => {
    const result = performanceDataSchema.safeParse({ id: document.id, ...document.data() });
    if (result.success) return [result.data as unknown as PerformanceData];
    console.error(`Ignoring invalid performance document ${document.ref.path}:`, result.error.flatten());
    return [];
  }).sort((left, right) => left.date.localeCompare(right.date));
}

export async function fetchShopData(): Promise<ShopData> {
  const actor = await getCurrentActor();
  return loadShopDirectory(actor);
}
