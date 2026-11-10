import "server-only";

import { Hono } from "hono";
import { contextStorage } from "hono/context-storage";

import { privateHeaders } from "@/server/http";
import { rpc } from "@/server/rpc";
import { appDataRoutes } from "@/server/routes/app-data";
import { authRoutes } from "@/server/routes/auth";
import { shopRoutes } from "@/server/routes/shops";

/** All /api routes. Static files and the SPA are served by main.ts. */
export function createApp() {
  const app = new Hono();
  // Lets server code read the current request (cookies, per-request cache).
  app.use(contextStorage());

  app.route("/api/auth", authRoutes);
  app.route("/api/shops", shopRoutes);
  app.route("/api/rpc", rpc);
  app.route("/api", appDataRoutes);
  app.all("/api/*", c => c.json({ error: "Not found." }, 404, privateHeaders));

  app.onError((error, c) => {
    console.error(`Unhandled error on ${c.req.method} ${c.req.path}:`, error);
    return c.json({ error: "Internal server error." }, 500, privateHeaders);
  });

  return app;
}
