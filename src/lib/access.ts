import "server-only";

import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/auth-constants";
import { getActorForSession } from "@/lib/local-auth";
import type { AppActor } from "@/lib/auth-types";

export type { AppActor, AppRole } from "@/lib/auth-types";

export async function getCurrentActor(): Promise<AppActor> {
  const sessionCookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) throw new Error("UNAUTHENTICATED");
  const actor = await getActorForSession(sessionCookie);
  if (!actor) throw new Error("UNAUTHENTICATED");
  return actor;
}

export async function requireAdmin() {
  const actor = await getCurrentActor();
  if (actor.role !== "admin") throw new Error("ADMIN_REQUIRED");
  return actor;
}

export async function requireEditor() {
  const actor = await getCurrentActor();
  if (actor.role === "viewer") throw new Error("EDITOR_REQUIRED");
  return actor;
}

export function canAccessShop(actor: AppActor, shopId: string) {
  return actor.role === "admin" || actor.shopIds.includes(shopId);
}

export async function requireShopAccess(shopId: string) {
  const actor = await getCurrentActor();
  if (!canAccessShop(actor, shopId)) throw new Error("SHOP_ACCESS_REQUIRED");
  return actor;
}

export async function requireEditorForShops(shopIds: string[]) {
  const actor = await requireEditor();
  if (actor.role !== "admin" && shopIds.some(shopId => !actor.shopIds.includes(shopId))) {
    throw new Error("SHOP_ACCESS_REQUIRED");
  }
  return actor;
}
