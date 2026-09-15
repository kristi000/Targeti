import "server-only";

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

export async function loadShops(): Promise<Shop[]> {
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
}

export async function loadSupervisors(): Promise<Supervisor[]> {
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
}

export async function loadWeightProfiles(): Promise<MetricWeightProfile[]> {
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
}

export async function loadShopDirectory(actor?: AppActor): Promise<ShopData> {
  const [shops, supervisors, weightProfiles] = await Promise.all([
    loadShops(),
    loadSupervisors(),
    loadWeightProfiles(),
  ]);

  const accessibleShops = actor && actor.role !== "admin"
    ? shops.filter(shop => actor.shopIds.includes(shop.id))
    : shops;

  return {
    shops: accessibleShops,
    supervisors,
    weightProfiles,
    monthlyTargets: Object.fromEntries(
      accessibleShops.flatMap(shop =>
        shop.monthlyTargets ? [[shop.id, shop.monthlyTargets] as const] : [],
      ),
    ),
  };
}
