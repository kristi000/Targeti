import { getIdTokenResult } from "firebase/auth";
import { z } from "zod";
import { firebaseAuth } from "@/lib/firebase-client";
import type { AppActor } from "@/lib/auth-types";

const actorClaimsSchema = z.object({
  appRole: z.enum(["admin", "editor", "viewer"]),
  appUsername: z.string().min(1),
  appName: z.string().min(1),
});

let currentActor: AppActor | null = null;

export function setCurrentClientActor(actor: AppActor | null) {
  currentActor = actor;
}

export async function getCurrentActor(): Promise<AppActor> {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("UNAUTHENTICATED");
  if (currentActor?.id === user.uid) return currentActor;
  const claims = actorClaimsSchema.safeParse((await getIdTokenResult(user)).claims);
  if (!claims.success) throw new Error("UNAUTHENTICATED");
  currentActor = {
    id: user.uid,
    username: claims.data.appUsername,
    name: claims.data.appName,
    role: claims.data.appRole,
  };
  return currentActor;
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
