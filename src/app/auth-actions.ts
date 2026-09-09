"use server";

import { z } from "zod";
import { adminDb } from "@/lib/firebase-admin";
import { getCurrentActor, requireAdmin } from "@/lib/access";
import { createManagedUser, listManagedUsers, managedRoleSchema, setManagedUserRole, usernameSchema } from "@/lib/local-auth";
import { activityEventSchema } from "@/lib/persistence-schemas";
import type { ActivityEvent } from "@/lib/types";

export type AuthUser = {
  id: string;
  username: string;
  name: string;
  role: "admin" | "editor" | "viewer";
  lastSignInAt: string | null;
};

const createAuthUserSchema = z.object({
  username: usernameSchema,
  name: z.string().trim().min(1).max(120),
  password: z.string().min(2).max(128),
  role: managedRoleSchema,
}).strict();

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
    { id: "local-admin", username: "admin", name: "@Kristi", role: "admin", lastSignInAt: null },
    ...users.map(user => ({ id: user.id, username: user.username, name: user.name, role: user.role, lastSignInAt: user.lastSignInAt })),
  ];
}

export async function handleCreateAuthUser(input: { username: string; name: string; password: string; role: "editor" | "viewer" }) {
  try {
    await requireAdmin();
    const user = await createManagedUser(createAuthUserSchema.parse(input));
    await recordActivity({ action: "user_created", summary: `Created ${user.role} profile ${user.username}.`, shopIds: [], shopNames: [], metadata: { userId: user.id, role: user.role } });
    return { success: true as const, user: { id: user.id, username: user.username, name: user.name, role: user.role, lastSignInAt: user.lastSignInAt } satisfies AuthUser };
  } catch (error) {
    if (error instanceof Error && error.message === "USERNAME_TAKEN") return { success: false as const, error: "That username is already in use." };
    return { success: false as const, error: mutationError("create the user profile", error) };
  }
}

export async function handleSetUserRole(userId: string, role: "editor" | "viewer") {
  try {
    await requireAdmin();
    const validUserId = z.string().uuid().parse(userId);
    const validRole = managedRoleSchema.parse(role);
    const user = await setManagedUserRole(validUserId, validRole);
    await recordActivity({ action: "user_role_changed", summary: `Changed ${user.username} to ${validRole}.`, shopIds: [], shopNames: [], metadata: { userId: validUserId, role: validRole } });
    return { success: true as const, role: validRole };
  } catch (error) {
    return { success: false as const, error: mutationError("change the user role", error) };
  }
}
