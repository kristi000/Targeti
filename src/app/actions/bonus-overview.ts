"use server";

import { z } from "zod";
import { canAccessShop, getCurrentActor } from "@/lib/access";
import { adminDb } from "@/lib/firebase-admin";
import { requireRestrictedAccess } from "@/lib/restricted-access";
import { bonusSnapshotSchema, monthSchema, shopIdSchema, shopSchema } from "@/lib/persistence-schemas";
import { bonusOverviewDocumentSchema, bonusOverviewReference, loadBonusPerformance, syncBonusOverviewProjection } from "@/lib/bonus-overview-index";
import type { Shop } from "@/lib/types";

const buildSchema = z.object({ items: z.array(z.object({ month: monthSchema, shopId: shopIdSchema }).strict()).min(1).max(2) }).strict();

async function validateAccess(shopIds: string[]) {
  const actor = await getCurrentActor();
  if (shopIds.some(shopId => !canAccessShop(actor, shopId))) throw new Error("SHOP_ACCESS_REQUIRED");
}

export async function buildBonusOverviewBatch(input: { items: Array<{ month: string; shopId: string }> }): Promise<void> {
  await requireRestrictedAccess();
  const { items } = buildSchema.parse(input);
  await validateAccess(items.map(item => item.shopId));
  const buildOne = async ({ month, shopId }: { month: string; shopId: string }) => {
    const reference = bonusOverviewReference(month, shopId);
    const existing = await reference.get();
    if (bonusOverviewDocumentSchema.safeParse(existing.data()).success) return;
    const shopDocument = await adminDb.collection("shops").doc(shopId).get();
    if (!shopDocument.exists) {
      await reference.set({ schemaVersion: 2, updatedAt: new Date().toISOString(), rows: [] });
      return;
    }
    const parsed = shopSchema.safeParse({ id: shopDocument.id, ...shopDocument.data() });
    if (!parsed.success) {
      console.error(`Ignoring invalid shop ${shopDocument.ref.path}:`, parsed.error.flatten());
      await reference.set({ schemaVersion: 2, updatedAt: new Date().toISOString(), rows: [] });
      return;
    }
    const snapshot = await adminDb.collection("shops").doc(shopId).collection("bonusSnapshots").doc(month).get();
    const hasValidSnapshot = snapshot.exists && bonusSnapshotSchema.safeParse(snapshot.data()).success;
    await syncBonusOverviewProjection(parsed.data as Shop, month, hasValidSnapshot ? [] : await loadBonusPerformance(shopId, month));
  };
  for (const item of items) await buildOne(item);
}
