import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { SESSION_COOKIE_NAME } from "@/lib/auth-constants"
import { adminAuth, adminDb } from "@/lib/firebase-admin"
import {
  authenticate,
  createSession,
  getActorForSession,
  passwordSchema,
  SESSION_DURATION_MS,
  usernameSchema,
  type LocalActor,
} from "@/lib/local-auth"

const bodySchema = z
  .object({ username: usernameSchema, password: passwordSchema })
  .strict()

function firstForwardedValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || null
}

function hasValidRequestOrigin(request: NextRequest) {
  const origin = request.headers.get("origin")
  if (!origin) return false
  const host =
    firstForwardedValue(request.headers.get("x-forwarded-host")) ??
    request.headers.get("host")
  const protocol =
    firstForwardedValue(request.headers.get("x-forwarded-proto")) ??
    request.nextUrl.protocol.slice(0, -1)
  if (!host) return origin === request.nextUrl.origin
  try {
    return new URL(origin).origin === new URL(`${protocol}://${host}`).origin
  } catch {
    return false
  }
}

async function createClientSession(actor: LocalActor) {
  const updatedAt = new Date().toISOString()
  await adminDb.collection("accessProfiles").doc(actor.id).set(
    {
      username: actor.username,
      name: actor.name,
      role: actor.role,
      updatedAt,
    },
    { merge: true },
  )
  const firebaseToken = await adminAuth.createCustomToken(actor.id, {
    appRole: actor.role,
    appUsername: actor.username,
    appName: actor.name,
  })
  return { firebaseToken, actor }
}

export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value
  const actor = sessionToken ? await getActorForSession(sessionToken) : null
  if (!actor)
    return NextResponse.json(
      { error: "Your session has expired." },
      { status: 401 },
    )
  try {
    return NextResponse.json(await createClientSession(actor))
  } catch (error) {
    console.error("Firebase client session creation failed:", error)
    return NextResponse.json(
      { error: "Could not initialize the client session." },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  if (!hasValidRequestOrigin(request))
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    )
  try {
    const credentials = bodySchema.parse(await request.json())
    const actor = await authenticate(credentials.username, credentials.password)
    if (!actor)
      return NextResponse.json(
        { error: "Incorrect username or password." },
        { status: 401 },
      )
    const sessionToken = await createSession(actor)
    const response = NextResponse.json({
      success: true,
      ...(await createClientSession(actor)),
    })
    response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION_MS / 1000,
    })
    return response
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json(
        { error: "Enter a valid username and password." },
        { status: 400 },
      )
    console.error("Local session creation failed:", error)
    return NextResponse.json(
      { error: "Could not create a secure session." },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  if (!hasValidRequestOrigin(request))
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    )
  const response = NextResponse.json({ success: true })
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
  return response
}
