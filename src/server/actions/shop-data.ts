"use server";

import { collection, getDocs, orderBy, query, where } from "@/lib/firebase-admin";
import { getCurrentActor, requireShopAccess } from "@/lib/access";
import { loadAccessibleShops, loadShopDirectory } from "@/lib/shop-directory";
import { monthSchema, performanceDataSchema, shopIdSchema, shopSchema } from "@/lib/persistence-schemas";
import { loadPerformanceIndex } from "@/lib/performance-index";
import { type PerformanceData, type PerformanceIndexEntry, type Shop, type ShopData } from "@/lib/types";
import { adminDb as db } from "@/lib/firebase-admin";
import { measureServerOperation } from "@/lib/server/performance";

export async function fetchShops(): Promise<Shop[]> {
  const actor = await getCurrentActor();
  return loadAccessibleShops(actor);
}

export async function fetchShop(shopId: string): Promise<Shop> {
  return measureServerOperation("shop.refresh", () => loadShop(shopId));
}

async function loadShop(shopId: string): Promise<Shop> {
  const validShopId = shopIdSchema.parse(shopId);
  await requireShopAccess(validShopId);
  const snapshot = await db.collection("shops").doc(validShopId).get();
  if (!snapshot.exists) throw new Error("SHOP_NOT_FOUND");
  return shopSchema.parse({ ...snapshot.data(), id: snapshot.id }) as Shop;
}

export async function fetchShopPerformanceForMonth(shopId: string, month: string): Promise<PerformanceData[]> {
  return measureServerOperation("performance.month", () => loadShopPerformanceForMonth(shopId, month));
}

async function loadShopPerformanceForMonth(shopId: string, month: string): Promise<PerformanceData[]> {
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
  return measureServerOperation("performance.index", () => loadShopPerformanceIndex(shopId));
}

async function loadShopPerformanceIndex(shopId: string): Promise<PerformanceIndexEntry[]> {
  const validShopId = shopIdSchema.parse(shopId);
  await requireShopAccess(validShopId);
  return loadPerformanceIndex(validShopId);
}

export async function fetchShopData(): Promise<ShopData> {
  const actor = await getCurrentActor();
  return measureServerOperation("shop.directory", () => loadShopDirectory(actor));
}
