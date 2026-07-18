import "server-only";

import { createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { adminDb } from "@/lib/firebase-admin";

function derivePassword(password: string, salt: Buffer, length: number, options: { N: number; r: number; p: number; maxmem: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, length, options, (error, derivedKey) => error ? reject(error) : resolve(derivedKey));
  });
}

export const appRoleSchema = z.enum(["admin", "editor", "viewer"]);
export const managedRoleSchema = z.enum(["editor", "viewer"]);
export const usernameSchema = z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, "Use only letters, numbers, dots, underscores, or hyphens.");
export const passwordSchema = z.string().min(2).max(128);

const storedUserSchema = z.object({
  username: usernameSchema,
  normalizedUsername: z.string().min(3).max(40),
  name: z.string().trim().min(1).max(120),
  passwordHash: z.string().min(1),
  role: managedRoleSchema,
  sessionVersion: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastSignInAt: z.string().datetime().nullable(),
}).strict();

const sessionSchema = z.object({
  userId: z.string().min(1).max(128),
  sessionVersion: z.number().int().nonnegative(),
  expiresAt: z.string().datetime(),
}).strict();

export type StoredUser = z.infer<typeof storedUserSchema> & { id: string };
export type LocalActor = {
  id: string;
  username: string;
  name: string;
  role: z.infer<typeof appRoleSchema>;
};

export const ADMIN_ID = "local-admin";
export const ADMIN_USERNAME = "admin";
export const ADMIN_PASSWORD = "01";
export const SESSION_DURATION_MS = 5 * 24 * 60 * 60 * 1000;

export function normalizeUsername(username: string) {
  return username.trim().toLocaleLowerCase();
}

function usernameKey(normalizedUsername: string) {
  return createHash("sha256").update(normalizedUsername).digest("hex");
}

function sessionSecret() {
  return process.env.TARGETI_SESSION_SECRET || "targeti-local-session-signing-key-v1";
}

function sessionSignature(payload: string) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export async function hashPassword(password: string) {
  const validPassword = passwordSchema.parse(password);
  const salt = randomBytes(16);
  const derived = await derivePassword(validPassword, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

async function verifyPassword(password: string, encoded: string) {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltValue, hashValue] = parts;
  const expected = Buffer.from(hashValue, "base64url");
  const actual = await derivePassword(password, Buffer.from(saltValue, "base64url"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function matchesAdminPassword(password: string) {
  const actual = Buffer.from(password);
  const expected = Buffer.from(ADMIN_PASSWORD);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function findUserByUsername(username: string): Promise<StoredUser | null> {
  const normalizedUsername = normalizeUsername(username);
  const mapping = await adminDb.collection("authUsernames").doc(usernameKey(normalizedUsername)).get();
  const userId = mapping.data()?.userId;
  if (typeof userId !== "string") return null;
  const user = await adminDb.collection("authUsers").doc(userId).get();
  const parsed = storedUserSchema.safeParse(user.data());
  return parsed.success ? { id: user.id, ...parsed.data } : null;
}

export async function authenticate(username: string, password: string): Promise<LocalActor | null> {
  const normalizedUsername = normalizeUsername(username);
  if (normalizedUsername === ADMIN_USERNAME) {
    return matchesAdminPassword(password) ? { id: ADMIN_ID, username: ADMIN_USERNAME, name: "Administrator", role: "admin" } : null;
  }

  const user = await findUserByUsername(normalizedUsername);
  if (!user || !await verifyPassword(password, user.passwordHash)) return null;
  await adminDb.collection("authUsers").doc(user.id).update({ lastSignInAt: new Date().toISOString() });
  return { id: user.id, username: user.username, name: user.name, role: user.role };
}

export async function createSession(actor: LocalActor) {
  const user = actor.id === ADMIN_ID ? null : await adminDb.collection("authUsers").doc(actor.id).get();
  const sessionVersion = actor.id === ADMIN_ID ? 0 : storedUserSchema.parse(user?.data()).sessionVersion;
  const payload = Buffer.from(JSON.stringify(sessionSchema.parse({
    userId: actor.id,
    sessionVersion,
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS).toISOString(),
  }))).toString("base64url");
  return `${payload}.${sessionSignature(payload)}`;
}

export async function getActorForSession(token: string): Promise<LocalActor | null> {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expectedSignature = Buffer.from(sessionSignature(payload));
  const actualSignature = Buffer.from(signature);
  if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) return null;
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); }
  catch { return null; }
  const session = sessionSchema.safeParse(decoded);
  if (!session.success || Date.parse(session.data.expiresAt) <= Date.now()) return null;
  if (session.data.userId === ADMIN_ID) return { id: ADMIN_ID, username: ADMIN_USERNAME, name: "Administrator", role: "admin" };

  const userDocument = await adminDb.collection("authUsers").doc(session.data.userId).get();
  const user = storedUserSchema.safeParse(userDocument.data());
  if (!user.success || user.data.sessionVersion !== session.data.sessionVersion) return null;
  return { id: userDocument.id, username: user.data.username, name: user.data.name, role: user.data.role };
}

export async function createManagedUser(input: { username: string; name: string; password: string; role: z.infer<typeof managedRoleSchema> }) {
  const username = usernameSchema.parse(input.username);
  const normalizedUsername = normalizeUsername(username);
  if (normalizedUsername === ADMIN_USERNAME) throw new Error("USERNAME_TAKEN");
  const passwordHash = await hashPassword(input.password);
  const userId = randomUUID();
  const now = new Date().toISOString();
  const user = storedUserSchema.parse({
    username,
    normalizedUsername,
    name: z.string().trim().min(1).max(120).parse(input.name),
    passwordHash,
    role: managedRoleSchema.parse(input.role),
    sessionVersion: 0,
    createdAt: now,
    updatedAt: now,
    lastSignInAt: null,
  });
  const mappingReference = adminDb.collection("authUsernames").doc(usernameKey(normalizedUsername));
  const userReference = adminDb.collection("authUsers").doc(userId);
  await adminDb.runTransaction(async transaction => {
    if ((await transaction.get(mappingReference)).exists) throw new Error("USERNAME_TAKEN");
    transaction.create(mappingReference, { userId, normalizedUsername });
    transaction.create(userReference, user);
  });
  return { id: userId, ...user };
}

export async function listManagedUsers(): Promise<StoredUser[]> {
  const snapshot = await adminDb.collection("authUsers").orderBy("name", "asc").get();
  return snapshot.docs.flatMap(document => {
    const parsed = storedUserSchema.safeParse(document.data());
    return parsed.success ? [{ id: document.id, ...parsed.data }] : [];
  });
}

export async function setManagedUserRole(userId: string, role: z.infer<typeof managedRoleSchema>) {
  const reference = adminDb.collection("authUsers").doc(userId);
  return adminDb.runTransaction(async transaction => {
    const document = await transaction.get(reference);
    const user = storedUserSchema.parse(document.data());
    const validRole = managedRoleSchema.parse(role);
    if (user.role !== validRole) transaction.update(reference, { role: validRole, sessionVersion: user.sessionVersion + 1, updatedAt: new Date().toISOString() });
    return { ...user, role: validRole };
  });
}
