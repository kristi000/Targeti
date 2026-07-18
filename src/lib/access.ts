import "server-only";

import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/auth-constants";
import { getActorForSession, type LocalActor } from "@/lib/local-auth";

export type AppRole = LocalActor["role"];
export type AppActor = LocalActor;

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
