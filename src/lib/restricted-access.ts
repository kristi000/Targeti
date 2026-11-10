import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { SESSION_COOKIE_NAME } from "@/lib/auth-constants";
import { requestCookie } from "@/server/request-context";

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
  const sessionToken = requestCookie(SESSION_COOKIE_NAME);
  const accessToken = requestCookie(RESTRICTED_ACCESS_COOKIE_NAME);
  return !!sessionToken && !!accessToken && isRestrictedAccessTokenValid(sessionToken, accessToken);
}

export async function requireRestrictedAccess() {
  if (!await hasRestrictedAccess()) throw new Error("RESTRICTED_ACCESS_REQUIRED");
}
