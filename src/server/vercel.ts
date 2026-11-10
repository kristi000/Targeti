import type { IncomingMessage, ServerResponse } from "node:http";
import { getRequestListener } from "@hono/node-server";

import { createApp } from "@/server/app";
import { redirectPageRequest } from "@/server/page-redirects";

/*
 * Vercel serverless function. scripts/build-vercel.mjs routes /api/* and
 * signed-out page requests here; Vercel serves everything else statically.
 * Environment variables come from the Vercel project settings.
 */
const app = createApp();
app.get("*", c => redirectPageRequest(c) ?? c.notFound());

const listener = getRequestListener(app.fetch);

/** Vercel rewrites requests to /api; the original path arrives as ?__pathname=. */
export function restoreOriginalUrl(url: string) {
  const parsed = new URL(url, "http://localhost");
  const pathname = parsed.searchParams.get("__pathname");
  if (!pathname) return url;
  parsed.searchParams.delete("__pathname");
  return `${pathname}${parsed.search}`;
}

export default function handler(request: IncomingMessage, response: ServerResponse) {
  request.url = restoreOriginalUrl(request.url ?? "/");
  return listener(request, response);
}
