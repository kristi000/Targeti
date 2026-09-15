import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/auth-constants";

export const RESTRICTED_ACCESS_COOKIE_NAME = "targeti_restricted_access";

function restrictedAccessSignature(sessionToken: string) {
  const secret = process.env.TARGETI_SESSION_SECRET || "targeti-local-session-signing-key-v1";
  return createHmac("sha256", secret)
    .update(`restricted-access:${sessionToken}`)
    .digest("base64url");
}

export function createRestrictedAccessToken(sessionToken: string) {
  return restrictedAccessSignature(sessionToken);
}

export function isRestrictedAccessTokenValid(sessionToken: string, accessToken: string) {
  const expected = Buffer.from(restrictedAccessSignature(sessionToken));
  const actual = Buffer.from(accessToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function hasRestrictedAccess() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const accessToken = cookieStore.get(RESTRICTED_ACCESS_COOKIE_NAME)?.value;
  return !!sessionToken && !!accessToken && isRestrictedAccessTokenValid(sessionToken, accessToken);
}

export async function requireRestrictedAccess() {
  if (!await hasRestrictedAccess()) throw new Error("RESTRICTED_ACCESS_REQUIRED");
}
