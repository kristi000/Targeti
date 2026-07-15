import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/lib/firebase-admin";
import { SESSION_COOKIE_NAME } from "@/lib/auth-constants";

const bodySchema = z.object({ idToken: z.string().min(100).max(10_000) }).strict();
const SESSION_DURATION_MS = 5 * 24 * 60 * 60 * 1000;

function configuredValues(name: string) {
  return new Set((process.env[name] ?? "").split(",").map(value => value.trim().toLocaleLowerCase()).filter(Boolean));
}

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
    const { idToken } = bodySchema.parse(await request.json());
    const token = await adminAuth.verifyIdToken(idToken, true);
    const email = token.email?.trim().toLocaleLowerCase();
    if (!email || token.email_verified !== true) return NextResponse.json({ error: "A verified email address is required." }, { status: 403 });
    if (Date.now() / 1000 - token.auth_time > 5 * 60) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

    const allowedDomains = configuredValues("TARGETI_ALLOWED_EMAIL_DOMAINS");
    const domain = email.split("@")[1] ?? "";
    if (allowedDomains.size && !allowedDomains.has(domain)) return NextResponse.json({ error: "This account is not allowed to access Targeti." }, { status: 403 });

    const bootstrapAdmins = configuredValues("TARGETI_BOOTSTRAP_ADMIN_EMAILS");
    if (bootstrapAdmins.has(email) && token.role !== "admin") {
      const user = await adminAuth.getUser(token.uid);
      await adminAuth.setCustomUserClaims(token.uid, { ...user.customClaims, role: "admin" });
      return NextResponse.json({ code: "claims-refresh-required" }, { status: 409 });
    }

    const sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn: SESSION_DURATION_MS });
    const response = NextResponse.json({ success: true });
    response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION_MS / 1000,
    });
    return response;
  } catch (error) {
    console.error("Firebase session creation failed:", error);
    return NextResponse.json({ error: "Could not create a secure session." }, { status: 401 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!hasValidRequestOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
