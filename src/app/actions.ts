"use server";

import { revalidateTag, unstable_cache } from "next/cache";
import { z } from "zod";

import { adminDb } from "@/lib/firebase-admin";
import {
  bonusSnapshotSchema,
  newShopSchema,
  performanceDataListSchema,
  performanceDataSchema,
  shopIdSchema,
  shopSchema,
  targetSchema,
} from "@/lib/persistence-schemas";
import { getInitialTargets, type BonusSnapshot, type PerformanceData, type Shop, type Target } from "@/lib/types";

export type ShopData = {
  shops: Shop[];
  performanceData: Record<string, PerformanceData[]>;
  monthlyTargets: Record<string, Target>;
};

const SHOP_DATA_CACHE_TAG = "shop-data";

function invalidateShopData() {
  revalidateTag(SHOP_DATA_CACHE_TAG);
}

function validationMessage(error: z.ZodError) {
  return error.issues[0]?.message ?? "Invalid data.";
}

function mutationError(operation: string, error: unknown) {
  if (error instanceof z.ZodError) return validationMessage(error);
  console.error(`Firestore ${operation} failed:`, error);
  return `Could not ${operation}. Please try again.`;
}

function parseFirestoreDocument<T>(schema: z.ZodType<T>, id: string, value: unknown): T | null {
  const result = schema.safeParse({ id, ...(value as Record<string, unknown>) });
  if (result.success) return result.data;
  console.error(`Ignoring invalid Firestore document ${id}:`, result.error.flatten());
  return null;
}

function toFirestoreData<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => toFirestoreData(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, entry]) =>
        entry === undefined ? [] : [[key, toFirestoreData(entry)]],
      ),
    ) as T;
  }
  return value;
}

export async function handleSaveTargets(shopId: string, targets: Target) {
  try {
    const validShopId = shopIdSchema.parse(shopId);
    const validTargets = targetSchema.parse(targets) as Target;
    await adminDb.doc(`shops/${validShopId}`).update({ monthlyTargets: validTargets });
    invalidateShopData();
    return { success: true as const, data: validTargets };
  } catch (error) {
    return { success: false as const, error: mutationError("save targets", error) };
  }
}

async function savePerformanceData(shopId: string, data: PerformanceData[], useImportId: boolean) {
  const validShopId = shopIdSchema.parse(shopId);
  // Zod's catch-all output cannot express the mixed repId/metric index signature,
  // but the schema has validated every property before this conversion.
  const validData = performanceDataListSchema.parse(data) as unknown as PerformanceData[];
  const batch = adminDb.batch();

  validData.forEach(entry => {
    const documentId = useImportId ? entry.importId ?? entry.date : entry.date;
    batch.set(adminDb.doc(`shops/${validShopId}/performance/${documentId}`), toFirestoreData(entry));
  });

  await batch.commit();
  invalidateShopData();
  return validData;
}

export async function handleSavePerformanceData(shopId: string, data: PerformanceData[]) {
  try {
    const validData = await savePerformanceData(shopId, data, false);
    return { success: true as const, data: validData };
  } catch (error) {
    return { success: false as const, error: mutationError("save performance data", error) };
  }
}

export async function handleSaveExcelPerformanceData(shopId: string, data: PerformanceData[]) {
  try {
    const validData = await savePerformanceData(shopId, data, true);
    return { success: true as const, data: validData };
  } catch (error) {
    return { success: false as const, error: mutationError("save Excel performance data", error) };
  }
}

export async function saveBonusSnapshot(shopId: string, snapshot: BonusSnapshot) {
  try {
    const validShopId = shopIdSchema.parse(shopId);
    const validSnapshot = bonusSnapshotSchema.parse(snapshot) as BonusSnapshot;
    const snapshotRef = adminDb.doc(`shops/${validShopId}/bonusSnapshots/${validSnapshot.month}`);

    await adminDb.runTransaction(async transaction => {
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

export async function fetchBonusSnapshots(shopId: string): Promise<Record<string, BonusSnapshot>> {
  const validShopId = shopIdSchema.parse(shopId);
  const snapshot = await adminDb.collection(`shops/${validShopId}/bonusSnapshots`).get();

  return Object.fromEntries(snapshot.docs.flatMap(document => {
    const result = bonusSnapshotSchema.safeParse(document.data());
    if (result.success) return [[document.id, result.data as BonusSnapshot] as const];
    console.error(`Ignoring invalid bonus snapshot ${document.ref.path}:`, result.error.flatten());
    return [];
  }));
}

export async function handleAddShop(shopName: string, description?: string) {
  try {
    const input = newShopSchema.parse({ name: shopName, description });
    const monthlyTargets = getInitialTargets();
    const shopData = {
      name: input.name,
      description: input.description ?? "",
      salesRepresentatives: [],
      monthlyTargets,
      createdAt: new Date().toISOString(),
    };
    const document = await adminDb.collection("shops").add(toFirestoreData(shopData));
    invalidateShopData();

    return {
      success: true as const,
      data: { id: document.id, ...shopData } satisfies Shop,
    };
  } catch (error) {
    return { success: false as const, error: mutationError("add the shop", error) };
  }
}

export async function handleUpdateShop(shop: Shop) {
  try {
    const validShop = shopSchema.parse(shop) as Shop;
    const { id, ...shopData } = validShop;
    await adminDb.doc(`shops/${id}`).update(toFirestoreData(shopData));
    invalidateShopData();
    return { success: true as const, data: validShop };
  } catch (error) {
    return { success: false as const, error: mutationError("update the shop", error) };
  }
}

export async function handleDeleteShop(shopId: string) {
  try {
    const validShopId = shopIdSchema.parse(shopId);
    await adminDb.recursiveDelete(adminDb.doc(`shops/${validShopId}`));
    invalidateShopData();
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: mutationError("delete the shop", error) };
  }
}

export async function handleClearAllData() {
  try {
    await adminDb.recursiveDelete(adminDb.collection("shops"));
    invalidateShopData();
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: mutationError("clear application data", error) };
  }
}

export async function fetchShops(): Promise<Shop[]> {
  const snapshot = await adminDb.collection("shops").get();
  return snapshot.docs.flatMap(document => {
    const shop = parseFirestoreDocument(shopSchema, document.id, document.data());
    return shop ? [shop as Shop] : [];
  });
}

export async function fetchPerformanceData(shopId: string): Promise<PerformanceData[]> {
  const validShopId = shopIdSchema.parse(shopId);
  const snapshot = await adminDb.collection(`shops/${validShopId}/performance`).get();
  return snapshot.docs.flatMap(document => {
    const result = performanceDataSchema.safeParse({ id: document.id, ...document.data() });
    if (result.success) return [result.data as unknown as PerformanceData];
    console.error(`Ignoring invalid performance document ${document.ref.path}:`, result.error.flatten());
    return [];
  }).sort((left, right) => left.date.localeCompare(right.date));
}

const loadShopData = unstable_cache(async (): Promise<ShopData> => {
  const [shops, performanceSnapshot] = await Promise.all([
    fetchShops(),
    adminDb.collectionGroup("performance").get(),
  ]);
  const performanceData = Object.fromEntries(shops.map(shop => [shop.id, [] as PerformanceData[]]));

  performanceSnapshot.forEach(document => {
    const shopId = document.ref.parent.parent?.id;
    if (!shopId || !performanceData[shopId]) return;
    const result = performanceDataSchema.safeParse({ id: document.id, ...document.data() });
    if (result.success) performanceData[shopId].push(result.data as unknown as PerformanceData);
    else console.error(`Ignoring invalid performance document ${document.ref.path}:`, result.error.flatten());
  });
  Object.values(performanceData).forEach(entries => entries.sort((left, right) => left.date.localeCompare(right.date)));

  return {
    shops,
    performanceData,
    monthlyTargets: Object.fromEntries(
      shops.flatMap(shop => shop.monthlyTargets ? [[shop.id, shop.monthlyTargets] as const] : []),
    ),
  };
}, [SHOP_DATA_CACHE_TAG], { revalidate: 60, tags: [SHOP_DATA_CACHE_TAG] });

export async function fetchShopData(): Promise<ShopData> {
  return loadShopData();
}
