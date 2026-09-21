import "server-only";

import { cache } from "react";
import { adminDb, collection, getDocs } from "@/lib/firebase-admin";
import {
  metricWeightProfileSchema,
  shopSchema,
  supervisorSchema,
} from "@/lib/persistence-schemas";
import type {
  MetricWeightProfile,
  Shop,
  ShopData,
  Supervisor,
} from "@/lib/types";
import type { z } from "zod";
import type { AppActor } from "@/lib/auth-types";

function parseDirectoryDocument<T>(
  schema: z.ZodType<T>,
  path: string,
  id: string,
  value: unknown,
): T | null {
  const result = schema.safeParse({ id, ...(value as Record<string, unknown>) });
  if (result.success) return result.data;
  console.error(`Ignoring invalid Firestore document ${path}:`, result.error.flatten());
  return null;
}

export const loadShops = cache(async (): Promise<Shop[]> => {
  const snapshot = await getDocs(collection(adminDb, "shops"));
  return snapshot.docs.flatMap(document => {
    const shop = parseDirectoryDocument(
      shopSchema,
      document.ref.path,
      document.id,
      document.data(),
    );
    return shop ? [shop as Shop] : [];
  });
});

export const loadAccessibleShops = cache(async (actor: AppActor): Promise<Shop[]> => {
  if (actor.role === "admin" || actor.shopIds.length > 10) {
    const shops = await loadShops();
    return actor.role === "admin" ? shops : shops.filter(shop => actor.shopIds.includes(shop.id));
  }

  const documents = await Promise.all(actor.shopIds.map(shopId => adminDb.collection("shops").doc(shopId).get()));
  return documents.flatMap(document => {
    if (!document.exists) return [];
    const shop = parseDirectoryDocument(shopSchema, document.ref.path, document.id, document.data());
    return shop ? [shop as Shop] : [];
  });
});

export const loadSupervisors = cache(async (): Promise<Supervisor[]> => {
  const snapshot = await getDocs(collection(adminDb, "supervisors"));
  return snapshot.docs.flatMap(document => {
    const supervisor = parseDirectoryDocument(
      supervisorSchema,
      document.ref.path,
      document.id,
      document.data(),
    );
    return supervisor ? [supervisor as Supervisor] : [];
  }).sort((left, right) => left.name.localeCompare(right.name));
});

export const loadWeightProfiles = cache(async (): Promise<MetricWeightProfile[]> => {
  const snapshot = await getDocs(collection(adminDb, "weightProfiles"));
  return snapshot.docs.flatMap(document => {
    const profile = parseDirectoryDocument(
      metricWeightProfileSchema,
      document.ref.path,
      document.id,
      document.data(),
    );
    return profile ? [profile as MetricWeightProfile] : [];
  }).sort((left, right) => left.name.localeCompare(right.name));
});

export async function loadShopDirectory(actor?: AppActor): Promise<ShopData> {
  const [shops, supervisors, weightProfiles] = await Promise.all([
    actor ? loadAccessibleShops(actor) : loadShops(),
    loadSupervisors(),
    loadWeightProfiles(),
  ]);

  return {
    shops,
    supervisors,
    weightProfiles,
    monthlyTargets: Object.fromEntries(
      shops.flatMap(shop =>
        shop.monthlyTargets ? [[shop.id, shop.monthlyTargets] as const] : [],
      ),
    ),
  };
}
