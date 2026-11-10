// Must be imported first so env vars exist before Firebase initializes.
import "./load-env";

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";

import { createApp } from "@/server/app";
import { redirectPageRequest } from "@/server/page-redirects";

const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT) || (isProduction ? 3000 : 9003);
const app = createApp();

if (isProduction) {
  const clientRoot = resolve(process.env.CLIENT_DIST_DIR ?? "dist/client");
  const indexFile = resolve(clientRoot, "index.html");
  if (!existsSync(indexFile)) throw new Error(`Client build not found at ${indexFile}. Run "npm run build" first.`);
  const indexHtml = readFileSync(indexFile, "utf8");

  // Hashed build assets never change, so they can be cached forever.
  app.use("/assets/*", async (c, next) => {
    await next();
    if (c.res.ok) c.header("Cache-Control", "public, max-age=31536000, immutable");
  });
  const serveClientFile = serveStatic({ root: clientRoot });
  // index.html is only served by the page handler below, after the auth check.
  app.use("/*", (c, next) => c.req.path === "/" || c.req.path === "/index.html" ? next() : serveClientFile(c, next));

  // Pages: send signed-out visitors to the login screen before loading the app.
  app.get("*", c => redirectPageRequest(c) ?? c.html(indexHtml, 200, { "Cache-Control": "no-cache" }));
}

serve({ fetch: app.fetch, port }, info => {
  console.log(`D-one ${isProduction ? "server" : "API"} listening on http://localhost:${info.port}`);
});
