"use server";

import { z } from "zod";
import { adminDb } from "@/lib/firebase-admin";
import { getCurrentActor, requireAdmin } from "@/lib/access";
import { createManagedUser, listManagedUsers, managedRoleSchema, setManagedUserAccess, usernameSchema } from "@/lib/local-auth";
import { activityEventSchema, shopIdSchema } from "@/lib/persistence-schemas";
import type { ActivityEvent } from "@/lib/types";

export type AuthUser = {
  id: string;
  username: string;
  name: string;
  role: "admin" | "editor" | "viewer";
  lastSignInAt: string | null;
  shopIds: string[];
};

const createAuthUserSchema = z.object({
  username: usernameSchema,
  name: z.string().trim().min(1).max(120),
  password: z.string().min(2).max(128),
  role: managedRoleSchema,
  shopIds: z.array(shopIdSchema).max(500).refine(ids => new Set(ids).size === ids.length, "Each shop can only be assigned once."),
}).strict();

async function validateShopAssignments(shopIds: string[]) {
  const validShopIds = createAuthUserSchema.shape.shopIds.parse(shopIds);
  const shops = await adminDb.collection("shops").get();
  const namesById = new Map(shops.docs.map(document => [document.id, String(document.data().name ?? document.id)]));
  if (validShopIds.some(shopId => !namesById.has(shopId))) throw new Error("SHOP_NOT_FOUND");
  return { shopIds: validShopIds, shopNames: validShopIds.map(shopId => namesById.get(shopId)!) };
}

function validationMessage(error: z.ZodError) {
  return error.issues[0]?.message ?? "Invalid data.";
}

function mutationError(operation: string, error: unknown) {
  if (error instanceof z.ZodError) return validationMessage(error);
  if (error instanceof Error && error.message === "UNAUTHENTICATED") return "Your session has expired. Please sign in again.";
  if (error instanceof Error && error.message === "ADMIN_REQUIRED") return "Administrator permission is required for this action.";
  console.error(`Firestore ${operation} failed:`, error);
  return `Could not ${operation}. Please try again.`;
}

function toFirestoreData<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => toFirestoreData(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) =>
      entry === undefined ? [] : [[key, toFirestoreData(entry)]],
    )) as T;
  }
  return value;
}

async function recordActivity(event: Omit<ActivityEvent, "id" | "occurredAt" | "actor">) {
  const value = activityEventSchema.omit({ id: true }).parse({
    ...event,
    occurredAt: new Date().toISOString(),
    actor: await getCurrentActor(),
  });
  await adminDb.collection("activity").add(toFirestoreData(value));
}

export async function fetchAuthUsers(): Promise<AuthUser[]> {
  await requireAdmin();
  const users = await listManagedUsers();
  return [
    { id: "local-admin", username: "admin", name: "@Kristi", role: "admin", lastSignInAt: null, shopIds: [] },
    ...users.map(user => ({ id: user.id, username: user.username, name: user.name, role: user.role, lastSignInAt: user.lastSignInAt, shopIds: user.shopIds })),
  ];
}

export async function handleCreateAuthUser(input: { username: string; name: string; password: string; role: "editor" | "viewer"; shopIds: string[] }) {
  try {
    await requireAdmin();
    const value = createAuthUserSchema.parse(input);
    const assignments = await validateShopAssignments(value.shopIds);
    const user = await createManagedUser(value);
    await recordActivity({ action: "user_created", summary: `Created ${user.role} profile ${user.username}.`, ...assignments, metadata: { userId: user.id, role: user.role, shopCount: assignments.shopIds.length } });
    return { success: true as const, user: { id: user.id, username: user.username, name: user.name, role: user.role, lastSignInAt: user.lastSignInAt, shopIds: user.shopIds } satisfies AuthUser };
  } catch (error) {
    if (error instanceof Error && error.message === "USERNAME_TAKEN") return { success: false as const, error: "That username is already in use." };
    if (error instanceof Error && error.message === "SHOP_NOT_FOUND") return { success: false as const, error: "One or more assigned shops no longer exist." };
    return { success: false as const, error: mutationError("create the user profile", error) };
  }
}

export async function handleSetUserAccess(userId: string, role: "editor" | "viewer", shopIds: string[]) {
  try {
    await requireAdmin();
    const validUserId = z.string().uuid().parse(userId);
    const validRole = managedRoleSchema.parse(role);
    const assignments = await validateShopAssignments(shopIds);
    const user = await setManagedUserAccess(validUserId, validRole, assignments.shopIds);
    await recordActivity({ action: "user_access_changed", summary: `Updated access for ${user.username}.`, ...assignments, metadata: { userId: validUserId, role: validRole, shopCount: assignments.shopIds.length } });
    return { success: true as const, role: validRole, shopIds: assignments.shopIds };
  } catch (error) {
    if (error instanceof Error && error.message === "SHOP_NOT_FOUND") return { success: false as const, error: "One or more assigned shops no longer exist." };
    return { success: false as const, error: mutationError("change the user role", error) };
  }
}
