import "server-only";

import { Hono } from "hono";
import { z } from "zod";

import { getCurrentActor } from "@/lib/access";
import { performanceMetricNames, performanceRouteNames } from "@/lib/performance-metrics";
import { monthSchema } from "@/lib/persistence-schemas";
import { hasRestrictedAccess } from "@/lib/restricted-access";
import { loadAccessibleShops } from "@/lib/shop-directory";
import { readBonusOverviewAllTime, readBonusOverviewMonth } from "@/lib/server/bonus-overview-data";
import { getShopDirectory } from "@/lib/server/dashboard-loaders";
import { measureServerOperation, performanceMetricsEnabled } from "@/lib/server/performance";
import { hasValidRequestOrigin, privateHeaders } from "@/server/http";
import type { AppBootstrap } from "@/lib/app-bootstrap";

export const appDataRoutes = new Hono();

/** Signed-in user and shop directory needed to render the app shell. */
appDataRoutes.get("/bootstrap", async c => {
  try {
    const actor = await getCurrentActor();
    const directory = await getShopDirectory();
    const body: AppBootstrap = { actor, directory, performanceMetricsEnabled: performanceMetricsEnabled() };
    return c.json(body, 200, privateHeaders);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return c.json({ error: "UNAUTHENTICATED" }, 401, privateHeaders);
    }
    console.error("Failed to load the application shell:", error);
    return c.json({ error: "BOOTSTRAP_FAILED" }, 500, privateHeaders);
  }
});

const bonusOverviewQuerySchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("month"), month: monthSchema }).strict(),
  z.object({ scope: z.literal("all"), months: z.array(monthSchema).min(1).max(120) }).strict(),
]);

appDataRoutes.get("/bonus-overview", async c => {
  try {
    const actor = await getCurrentActor();
    if (!await hasRestrictedAccess()) return c.json({ error: "RESTRICTED_ACCESS_REQUIRED" }, 403, privateHeaders);
    const scope = c.req.query("scope");
    const input = bonusOverviewQuerySchema.safeParse(scope === "all"
      ? { scope: "all", months: c.req.queries("month") ?? [] }
      : { scope, month: c.req.query("month") ?? null });
    if (!input.success) return c.json({ error: "INVALID_QUERY" }, 400, privateHeaders);
    const shopIds = (await loadAccessibleShops(actor)).map(shop => shop.id);
    const value = input.data;
    const data = value.scope === "all"
      ? await measureServerOperation("bonus.all-time", () => readBonusOverviewAllTime([...new Set(value.months)].sort().reverse(), shopIds))
      : await measureServerOperation("bonus.month", () => readBonusOverviewMonth(value.month, shopIds));
    return c.json(data, 200, privateHeaders);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return c.json({ error: "UNAUTHENTICATED" }, 401, privateHeaders);
    }
    console.error("Failed to load bonus overview:", error);
    return c.json({ error: "BONUS_OVERVIEW_FAILED" }, 500, privateHeaders);
  }
});

const performanceBodySchema = z.object({ metrics: z.array(z.object({
  id: z.string().max(100).regex(/^v\d+-\d+-\d+$/),
  name: z.enum(performanceMetricNames), value: z.number().finite().nonnegative().max(86_400_000),
  route: z.enum(performanceRouteNames), viewport: z.enum(["mobile", "desktop"]),
}).strict()).min(1).max(5) }).strict();

async function readLimitedJson(request: Request, maxBytes: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_BODY");
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new Error("INVALID_BODY"); }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

appDataRoutes.post("/performance", async c => {
  if (!performanceMetricsEnabled()) return c.body(null, 204, privateHeaders);
  if (!hasValidRequestOrigin(c)) return c.body(null, 403, privateHeaders);
  try {
    await getCurrentActor();
  } catch {
    return c.body(null, 401, privateHeaders);
  }
  try {
    const { metrics } = performanceBodySchema.parse(await readLimitedJson(c.req.raw, 4096));
    for (const metric of metrics) console.info(JSON.stringify({
      event: "targeti.performance", source: "web-vitals", environment: process.env.NODE_ENV, ...metric,
    }));
    return c.body(null, 204, privateHeaders);
  } catch {
    return c.body(null, 400, privateHeaders);
  }
});
