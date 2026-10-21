import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { closingYearSchema, closingWorkbookFormatSchema, closingWorkbookContentDisposition } from "@/lib/annual-closing";
import { shopIdSchema } from "@/lib/persistence-schemas";
import { generateAnnualClosingWorkbook } from "@/lib/server/annual-closing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const exportQuerySchema = z.object({
  year: z.string().regex(/^\d{4}$/).transform(Number).pipe(closingYearSchema),
  format: closingWorkbookFormatSchema,
});

export async function GET(request: NextRequest, context: { params: Promise<{ shopId: string }> }) {
  try {
    const shopId = shopIdSchema.parse((await context.params).shopId);
    const { year, format } = exportQuerySchema.parse({
      year: request.nextUrl.searchParams.get("year"), format: request.nextUrl.searchParams.get("format"),
    });
    const { bytes, shopName } = await generateAnnualClosingWorkbook(shopId, year, format);
    return new NextResponse(Buffer.from(bytes), { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": closingWorkbookContentDisposition(format, shopName),
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "UNAUTHENTICATED" ? 401
      : ["SHOP_ACCESS_REQUIRED", "RESTRICTED_ACCESS_REQUIRED"].includes(message) ? 403
      : message === "SHOP_NOT_FOUND" ? 404
      : error instanceof z.ZodError || message.startsWith("INVALID_") ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? "invalidData" : status === 401 ? "sessionExpired" : status === 403 ? "accessDenied" : "exportFailed" }, {
      status, headers: { "Cache-Control": "private, no-store" },
    });
  }
}
