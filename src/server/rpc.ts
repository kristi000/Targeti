import "server-only";

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import superjson from "superjson";

import { hasValidRequestOrigin, privateHeaders } from "@/server/http";
import * as achievements from "@/server/actions/achievements";
import * as activity from "@/server/actions/activity";
import * as administration from "@/server/actions/administration";
import * as attendance from "@/server/actions/attendance";
import * as auth from "@/server/actions/auth";
import * as bonus from "@/server/actions/bonus";
import * as bonusOverview from "@/server/actions/bonus-overview";
import * as dailyActivity from "@/server/actions/daily-activity";
import * as dailyClosing from "@/server/actions/daily-closing";
import * as dashboard from "@/server/actions/dashboard";
import * as imports from "@/server/actions/imports";
import * as insights from "@/server/actions/insights";
import * as metricSettings from "@/server/actions/metric-settings";
import * as monthlyBank from "@/server/actions/monthly-bank";
import * as performance from "@/server/actions/performance";
import * as procedures from "@/server/actions/procedures";
import * as representatives from "@/server/actions/representatives";
import * as shopData from "@/server/actions/shop-data";
import * as shops from "@/server/actions/shops";
import * as supervisors from "@/server/actions/supervisors";
import * as weightProfiles from "@/server/actions/weight-profiles";

/**
 * Callable action modules, keyed by file name in src/server/actions.
 * Only files that start with "use server" belong here; the Vite plugin turns
 * client imports of those files into calls to this endpoint.
 */
const modules: Record<string, Record<string, unknown>> = {
  achievements,
  activity,
  administration,
  attendance,
  auth,
  bonus,
  "bonus-overview": bonusOverview,
  "daily-activity": dailyActivity,
  "daily-closing": dailyClosing,
  dashboard,
  imports,
  insights,
  "metric-settings": metricSettings,
  "monthly-bank": monthlyBank,
  performance,
  procedures,
  representatives,
  "shop-data": shopData,
  shops,
  supervisors,
  "weight-profiles": weightProfiles,
};

function findAction(moduleName: string, actionName: string) {
  if (!Object.hasOwn(modules, moduleName)) return null;
  const module = modules[moduleName];
  if (!Object.hasOwn(module, actionName)) return null;
  const action = module[actionName];
  return typeof action === "function" ? action as (...args: unknown[]) => unknown : null;
}

export const rpc = new Hono();

rpc.post(
  "/:module/:action",
  bodyLimit({ maxSize: 10 * 1024 * 1024, onError: c => c.json({ error: "Request body is too large." }, 413, privateHeaders) }),
  async c => {
    if (!hasValidRequestOrigin(c)) return c.json({ error: "Invalid request origin." }, 403, privateHeaders);
    const action = findAction(c.req.param("module"), c.req.param("action"));
    if (!action) return c.json({ error: "Unknown action." }, 404, privateHeaders);

    let args: unknown;
    try {
      args = superjson.parse(await c.req.text());
    } catch {
      args = null;
    }
    if (!Array.isArray(args)) return c.json({ error: "Invalid request body." }, 400, privateHeaders);

    try {
      const result = await action(...args);
      return c.body(superjson.stringify(result), 200, { ...privateHeaders, "Content-Type": "application/json" });
    } catch (error) {
      console.error(`Action ${c.req.param("module")}.${c.req.param("action")} failed:`, error);
      // Like Next.js server actions, hide error details from clients in production.
      const message = process.env.NODE_ENV === "production" || !(error instanceof Error)
        ? "An error occurred while processing the request."
        : error.message;
      return c.json({ error: message }, 500, privateHeaders);
    }
  },
);
