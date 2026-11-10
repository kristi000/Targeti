import "server-only";

import { timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { z } from "zod";

import { SESSION_COOKIE_NAME } from "@/lib/auth-constants";
import {
  authenticate,
  createSession,
  getActorForSession,
  passwordSchema,
  SESSION_DURATION_MS,
  usernameSchema,
} from "@/lib/local-auth";
import {
  createRestrictedAccessToken,
  isRestrictedAccessTokenValid,
  RESTRICTED_ACCESS_COOKIE_NAME,
} from "@/lib/restricted-access";
import { hasValidRequestOrigin, secureCookies } from "@/server/http";

const credentialsSchema = z.object({ username: usernameSchema, password: passwordSchema }).strict();
const accessCodeSchema = z.object({ code: z.string().regex(/^\d{5}$/) }).strict();
const RESTRICTED_ACCESS_CODE = "77777";

function setAuthCookie(c: Context, name: string, value: string, maxAge: number) {
  setCookie(c, name, value, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "Lax",
    path: "/",
    maxAge,
  });
}

async function getValidSessionToken(c: Context) {
  const sessionToken = getCookie(c, SESSION_COOKIE_NAME);
  if (!sessionToken || !await getActorForSession(sessionToken)) return null;
  return sessionToken;
}

export const authRoutes = new Hono();

authRoutes.get("/session", async c => {
  const sessionToken = getCookie(c, SESSION_COOKIE_NAME);
  const actor = sessionToken ? await getActorForSession(sessionToken) : null;
  if (!actor) return c.json({ error: "Your session has expired." }, 401);
  return c.json({ actor });
});

authRoutes.post("/session", async c => {
  if (!hasValidRequestOrigin(c)) return c.json({ error: "Invalid request origin." }, 403);
  try {
    const credentials = credentialsSchema.parse(await c.req.json());
    const actor = await authenticate(credentials.username, credentials.password);
    if (!actor) return c.json({ error: "Incorrect username or password." }, 401);
    const sessionToken = await createSession(actor);
    setAuthCookie(c, SESSION_COOKIE_NAME, sessionToken, SESSION_DURATION_MS / 1000);
    return c.json({ success: true, actor });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return c.json({ error: "Enter a valid username and password." }, 400);
    }
    console.error("Local session creation failed:", error);
    return c.json({ error: "Could not create a secure session." }, 500);
  }
});

authRoutes.delete("/session", c => {
  if (!hasValidRequestOrigin(c)) return c.json({ error: "Invalid request origin." }, 403);
  setAuthCookie(c, SESSION_COOKIE_NAME, "", 0);
  setAuthCookie(c, RESTRICTED_ACCESS_COOKIE_NAME, "", 0);
  return c.json({ success: true });
});

authRoutes.get("/restricted-access", async c => {
  const sessionToken = await getValidSessionToken(c);
  if (!sessionToken) return c.json({ error: "Your session has expired." }, 401);
  const accessToken = getCookie(c, RESTRICTED_ACCESS_COOKIE_NAME);
  return c.json({ hasAccess: !!accessToken && isRestrictedAccessTokenValid(sessionToken, accessToken) });
});

authRoutes.post("/restricted-access", async c => {
  if (!hasValidRequestOrigin(c)) return c.json({ error: "Invalid request origin." }, 403);
  const sessionToken = await getValidSessionToken(c);
  if (!sessionToken) return c.json({ error: "Your session has expired." }, 401);

  try {
    const { code } = accessCodeSchema.parse(await c.req.json());
    const actual = Buffer.from(code);
    const expected = Buffer.from(RESTRICTED_ACCESS_CODE);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return c.json({ error: "Incorrect access code." }, 401);
    }
    setAuthCookie(c, RESTRICTED_ACCESS_COOKIE_NAME, createRestrictedAccessToken(sessionToken), SESSION_DURATION_MS / 1000);
    return c.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return c.json({ error: "Enter the five-digit access code." }, 400);
    }
    console.error("Restricted access unlock failed:", error);
    return c.json({ error: "Could not verify the access code." }, 500);
  }
});
