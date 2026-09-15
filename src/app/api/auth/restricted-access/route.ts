import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE_NAME } from "@/lib/auth-constants";
import { getActorForSession, SESSION_DURATION_MS } from "@/lib/local-auth";
import {
  createRestrictedAccessToken,
  isRestrictedAccessTokenValid,
  RESTRICTED_ACCESS_COOKIE_NAME,
} from "@/lib/restricted-access";

const accessCodeSchema = z.object({ code: z.string().regex(/^\d{5}$/) }).strict();
const RESTRICTED_ACCESS_CODE = "77777";

function firstForwardedValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || null;
}

function hasValidRequestOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = firstForwardedValue(request.headers.get("x-forwarded-host")) ?? request.headers.get("host");
  const protocol = firstForwardedValue(request.headers.get("x-forwarded-proto")) ?? request.nextUrl.protocol.slice(0, -1);
  if (!host) return origin === request.nextUrl.origin;
  try {
    return new URL(origin).origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

async function getValidSessionToken(request: NextRequest) {
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken || !await getActorForSession(sessionToken)) return null;
  return sessionToken;
}

export async function GET(request: NextRequest) {
  const sessionToken = await getValidSessionToken(request);
  if (!sessionToken) return NextResponse.json({ error: "Your session has expired." }, { status: 401 });
  const accessToken = request.cookies.get(RESTRICTED_ACCESS_COOKIE_NAME)?.value;
  return NextResponse.json({ hasAccess: !!accessToken && isRestrictedAccessTokenValid(sessionToken, accessToken) });
}

export async function POST(request: NextRequest) {
  if (!hasValidRequestOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const sessionToken = await getValidSessionToken(request);
  if (!sessionToken) return NextResponse.json({ error: "Your session has expired." }, { status: 401 });

  try {
    const { code } = accessCodeSchema.parse(await request.json());
    const actual = Buffer.from(code);
    const expected = Buffer.from(RESTRICTED_ACCESS_CODE);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return NextResponse.json({ error: "Incorrect access code." }, { status: 401 });
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set(RESTRICTED_ACCESS_COOKIE_NAME, createRestrictedAccessToken(sessionToken), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION_MS / 1000,
    });
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Enter the five-digit access code." }, { status: 400 });
    console.error("Restricted access unlock failed:", error);
    return NextResponse.json({ error: "Could not verify the access code." }, { status: 500 });
  }
}
