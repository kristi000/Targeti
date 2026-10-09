import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentActor } from "@/lib/access";
import { performanceMetricNames, performanceRouteNames } from "@/lib/performance-metrics";
import { performanceMetricsEnabled } from "@/lib/server/performance";

const bodySchema = z.object({ metrics: z.array(z.object({
  id: z.string().max(100).regex(/^v\d+-\d+-\d+$/),
  name: z.enum(performanceMetricNames), value: z.number().finite().nonnegative().max(86_400_000),
  route: z.enum(performanceRouteNames), viewport: z.enum(["mobile", "desktop"]),
}).strict()).min(1).max(5) }).strict();
const privateHeaders = { "Cache-Control": "private, no-store" };

function hasValidOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim() ?? request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() ?? request.nextUrl.protocol.slice(0, -1);
  try {
    return !!origin && new URL(origin).origin === (host ? new URL(`${protocol}://${host}`).origin : request.nextUrl.origin);
  } catch {
    return false;
  }
}

async function readBody(request: NextRequest) {
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
      if (bytes > 4096) { await reader.cancel(); throw new Error("INVALID_BODY"); }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: NextRequest) {
  if (!performanceMetricsEnabled()) return new NextResponse(null, { status: 204, headers: privateHeaders });
  if (!hasValidOrigin(request)) return new NextResponse(null, { status: 403, headers: privateHeaders });
  try {
    await getCurrentActor();
  } catch {
    return new NextResponse(null, { status: 401, headers: privateHeaders });
  }
  try {
    const { metrics } = bodySchema.parse(await readBody(request));
    for (const metric of metrics) console.info(JSON.stringify({
      event: "targeti.performance", source: "web-vitals", environment: process.env.NODE_ENV, ...metric,
    }));
    return new NextResponse(null, { status: 204, headers: privateHeaders });
  } catch {
    return new NextResponse(null, { status: 400, headers: privateHeaders });
  }
}
