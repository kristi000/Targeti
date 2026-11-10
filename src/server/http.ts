import "server-only";

import type { Context } from "hono";

export const privateHeaders = { "Cache-Control": "private, no-store" } as const;

function firstForwardedValue(value: string | undefined) {
  return value?.split(",", 1)[0]?.trim() || null;
}

/** Same-origin check for state-changing requests (CSRF protection). */
export function hasValidRequestOrigin(c: Context) {
  const origin = c.req.header("origin");
  if (!origin) return false;
  const url = new URL(c.req.url);
  const host = firstForwardedValue(c.req.header("x-forwarded-host")) ?? c.req.header("host");
  const protocol = firstForwardedValue(c.req.header("x-forwarded-proto")) ?? url.protocol.slice(0, -1);
  if (!host) return origin === url.origin;
  try {
    return new URL(origin).origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

export const secureCookies = () => process.env.NODE_ENV === "production";
