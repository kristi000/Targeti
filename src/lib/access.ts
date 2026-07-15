import "server-only";

import { cookies } from "next/headers";
import { z } from "zod";
import { adminAuth } from "@/lib/firebase-admin";
import { SESSION_COOKIE_NAME } from "@/lib/auth-constants";

const roleSchema = z.enum(["admin", "editor", "viewer"]);

export type AppRole = z.infer<typeof roleSchema>;
export type AppActor = {
  id: string;
  name: string;
  email: string;
  role: AppRole;
};

export async function getCurrentActor(): Promise<AppActor> {
  const sessionCookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) throw new Error("UNAUTHENTICATED");
  try {
    const token = await adminAuth.verifySessionCookie(sessionCookie, true);
    const email = token.email?.trim();
    if (!email) throw new Error("UNAUTHENTICATED");
    return {
      id: token.uid,
      email,
      name: token.name?.trim() || email.split("@")[0] || "Targeti user",
      role: roleSchema.catch("viewer").parse(token.role),
    };
  } catch {
    throw new Error("UNAUTHENTICATED");
  }
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
