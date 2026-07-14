"use server";

import { revalidateTag, unstable_cache } from "next/cache";
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDocs,
  runTransaction,
  updateDoc,
  writeBatch,
  type DocumentReference,
} from "firebase/firestore";
import { z } from "zod";

import { db } from "@/lib/firebase";
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
    await updateDoc(doc(db, "shops", validShopId), { monthlyTargets: validTargets });
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
  const batch = writeBatch(db);

  validData.forEach(entry => {
    const documentId = useImportId ? entry.importId ?? entry.date : entry.date;
    batch.set(doc(db, "shops", validShopId, "performance", documentId), toFirestoreData(entry));
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
    const snapshotRef = doc(db, "shops", validShopId, "bonusSnapshots", validSnapshot.month);

    await runTransaction(db, async transaction => {
      if ((await transaction.get(snapshotRef)).exists()) throw new Error("ALREADY_FINALIZED");
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
  const snapshot = await getDocs(collection(db, "shops", validShopId, "bonusSnapshots"));

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
    const document = await addDoc(collection(db, "shops"), toFirestoreData(shopData));
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
    await updateDoc(doc(db, "shops", id), toFirestoreData(shopData));
    invalidateShopData();
    return { success: true as const, data: validShop };
  } catch (error) {
    return { success: false as const, error: mutationError("update the shop", error) };
  }
}

export async function handleDeleteShop(shopId: string) {
  try {
    const validShopId = shopIdSchema.parse(shopId);
    const shopRef = doc(db, "shops", validShopId);
    const [performance, bonusSnapshots] = await Promise.all([
      getDocs(collection(db, "shops", validShopId, "performance")),
      getDocs(collection(db, "shops", validShopId, "bonusSnapshots")),
    ]);
    const batch = writeBatch(db);
    performance.docs.forEach(item => batch.delete(item.ref));
    bonusSnapshots.docs.forEach(item => batch.delete(item.ref));
    batch.delete(shopRef);
    await batch.commit();
    invalidateShopData();
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: mutationError("delete the shop", error) };
  }
}

export async function handleClearAllData() {
  try {
    const shops = await getDocs(collection(db, "shops"));
    const references: DocumentReference[] = [];
    await Promise.all(shops.docs.map(async shop => {
      const [performance, bonusSnapshots] = await Promise.all([
        getDocs(collection(db, "shops", shop.id, "performance")),
        getDocs(collection(db, "shops", shop.id, "bonusSnapshots")),
      ]);
      references.push(...performance.docs.map(item => item.ref));
      references.push(...bonusSnapshots.docs.map(item => item.ref));
      references.push(shop.ref);
    }));
    for (let start = 0; start < references.length; start += 450) {
      const batch = writeBatch(db);
      references.slice(start, start + 450).forEach(reference => batch.delete(reference));
      await batch.commit();
    }
    invalidateShopData();
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: mutationError("clear application data", error) };
  }
}

export async function fetchShops(): Promise<Shop[]> {
  const snapshot = await getDocs(collection(db, "shops"));
  return snapshot.docs.flatMap(document => {
    const shop = parseFirestoreDocument(shopSchema, document.id, document.data());
    return shop ? [shop as Shop] : [];
  });
}

export async function fetchPerformanceData(shopId: string): Promise<PerformanceData[]> {
  const validShopId = shopIdSchema.parse(shopId);
  const snapshot = await getDocs(collection(db, "shops", validShopId, "performance"));
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
    getDocs(collectionGroup(db, "performance")),
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
