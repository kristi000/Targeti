// Must be imported first so env vars exist before Firebase initializes.
import "./load-env";

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { getCookie } from "hono/cookie";

import { SESSION_COOKIE_NAME } from "@/lib/auth-constants";
import { createApp } from "@/server/app";

const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT) || (isProduction ? 3000 : 9003);
const app = createApp();

if (isProduction) {
  const clientRoot = resolve(process.env.CLIENT_DIST_DIR ?? "dist/client");
  const indexFile = resolve(clientRoot, "index.html");
  if (!existsSync(indexFile)) throw new Error(`Client build not found at ${indexFile}. Run "npm run build" first.`);
  const indexHtml = readFileSync(indexFile, "utf8");
  const locales = ["en", "sq"];

  // Hashed build assets never change, so they can be cached forever.
  app.use("/assets/*", async (c, next) => {
    await next();
    if (c.res.ok) c.header("Cache-Control", "public, max-age=31536000, immutable");
  });
  const serveClientFile = serveStatic({ root: clientRoot });
  // index.html is only served by the page handler below, after the auth check.
  app.use("/*", (c, next) => c.req.path === "/" || c.req.path === "/index.html" ? next() : serveClientFile(c, next));

  // Pages: send signed-out visitors to the login screen before loading the app.
  app.get("*", c => {
    const path = c.req.path;
    const isAppPage = path === "/" || /^\/(en|sq)(\/|$)/.test(path);
    if (isAppPage && !getCookie(c, SESSION_COOKIE_NAME)) {
      const url = new URL(c.req.url);
      return c.redirect(`/login?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
    }
    if (path === "/") {
      const preferred = getCookie(c, "NEXT_LOCALE");
      const accepted = c.req.header("accept-language")?.toLowerCase() ?? "";
      const locale = preferred && locales.includes(preferred) ? preferred : accepted.startsWith("sq") ? "sq" : "en";
      return c.redirect(`/${locale}${new URL(c.req.url).search}`);
    }
    return c.html(indexHtml, 200, { "Cache-Control": "no-cache" });
  });
}

serve({ fetch: app.fetch, port }, info => {
  console.log(`D-one ${isProduction ? "server" : "API"} listening on http://localhost:${info.port}`);
});
