import "server-only";

import { z } from "zod";

import { getCurrentActor } from "@/lib/access";
import { adminDb as db, collection, setDoc } from "@/lib/firebase-admin";
import { activityEventSchema } from "@/lib/persistence-schemas";
import type { ActivityEvent } from "@/lib/types";

export function validationMessage(error: z.ZodError) {
  return error.issues[0]?.message ?? "Invalid data.";
}

export function mutationError(operation: string, error: unknown) {
  if (error instanceof z.ZodError) return validationMessage(error);
  if (error instanceof Error && error.message === "CLOSING_CONFLICT") return "This daily report has changed. Reload it before saving to avoid overwriting newer debt changes.";
  if (error instanceof Error && error.message === "UNAUTHENTICATED") return "Your session has expired. Please sign in again.";
  if (error instanceof Error && error.message === "ADMIN_REQUIRED") return "Administrator permission is required for this action.";
  if (error instanceof Error && error.message === "EDITOR_REQUIRED") return "Editor permission is required for this action.";
  if (error instanceof Error && error.message === "SHOP_ACCESS_REQUIRED") return "You do not have access to this shop.";
  console.error(`Firestore ${operation} failed:`, error);
  return `Could not ${operation}. Please try again.`;
}

export async function recordActivity(event: Omit<ActivityEvent, "id" | "occurredAt" | "actor">) {
  const activity = await createActivity(event);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await setDoc(activity.reference, activity.data);
      return;
    } catch (error) {
      if (attempt === 3) {
        console.error("Activity logging failed after three attempts.", { event, error });
      }
    }
  }
}

export async function createActivity(
  event: Omit<ActivityEvent, "id" | "occurredAt" | "actor">,
  actor = undefined as Awaited<ReturnType<typeof getCurrentActor>> | undefined,
) {
  const value = activityEventSchema.omit({ id: true }).parse({
    ...event,
    occurredAt: new Date().toISOString(),
    actor: actor ?? await getCurrentActor(),
  });
  return { reference: collection(db, "activity").doc(), data: toFirestoreData(value) };
}

export function parseFirestoreDocument<T>(schema: z.ZodType<T>, id: string, value: unknown): T | null {
  const result = schema.safeParse({ id, ...(value as Record<string, unknown>) });
  if (result.success) return result.data;
  console.error(`Ignoring invalid Firestore document ${id}:`, result.error.flatten());
  return null;
}

export function toFirestoreData<T>(value: T): T {
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

export function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export function omitId<T extends { id?: unknown }>(value: T): Omit<T, "id"> {
  const copy = { ...value };
  delete copy.id;
  return copy;
}
