import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE_NAME } from "@/lib/auth-constants";
import { authenticate, createSession, passwordSchema, SESSION_DURATION_MS, usernameSchema } from "@/lib/local-auth";

const bodySchema = z.object({ username: usernameSchema, password: passwordSchema }).strict();

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

export async function POST(request: NextRequest) {
  if (!hasValidRequestOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const credentials = bodySchema.parse(await request.json());
    const actor = await authenticate(credentials.username, credentials.password);
    if (!actor) return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
    const sessionToken = await createSession(actor);
    const response = NextResponse.json({ success: true });
    response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION_MS / 1000,
    });
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Enter a valid username and password." }, { status: 400 });
    console.error("Local session creation failed:", error);
    return NextResponse.json({ error: "Could not create a secure session." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!hasValidRequestOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
