import "server-only";

import type { Context } from "hono";
import { getCookie } from "hono/cookie";

import { SESSION_COOKIE_NAME } from "@/lib/auth-constants";

const locales = ["en", "sq"];

/**
 * Redirects for page (non-API) requests, matching the old Next.js middleware:
 * signed-out visitors go to /login, and "/" goes to the preferred language.
 * Returns null when the page should be served as-is.
 */
export function redirectPageRequest(c: Context): Response | null {
  const url = new URL(c.req.url);
  const path = url.pathname;
  const isAppPage = path === "/" || /^\/(en|sq)(\/|$)/.test(path);
  if (isAppPage && !getCookie(c, SESSION_COOKIE_NAME)) {
    return c.redirect(`/login?next=${encodeURIComponent(`${path}${url.search}`)}`);
  }
  if (path === "/") {
    const preferred = getCookie(c, "NEXT_LOCALE");
    const accepted = c.req.header("accept-language")?.toLowerCase() ?? "";
    const locale = preferred && locales.includes(preferred) ? preferred : accepted.startsWith("sq") ? "sq" : "en";
    return c.redirect(`/${locale}${url.search}`);
  }
  return null;
}
