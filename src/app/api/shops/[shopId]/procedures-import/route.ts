import { NextResponse } from "next/server";
import { requireEditorForShops } from "@/lib/access";
import { shopIdSchema } from "@/lib/persistence-schemas";
import { importProcedures, procedureImportSchema } from "@/lib/server/procedures";
import { readProceduresWorkbook } from "@/lib/procedures-workbook";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ shopId: string }> }) {
  try {
    const { shopId } = await params;
    shopIdSchema.parse(shopId);
    await requireEditorForShops([shopId]);
    const origin = request.headers.get("origin");
    const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() ?? request.headers.get("host");
    if (!origin || new URL(origin).host !== host) return NextResponse.json({ error: "importFailed" }, { status: 403 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx") || file.size > 2 * 1024 * 1024) throw new Error("invalidWorkbook");
    const input = procedureImportSchema.parse(JSON.parse(String(form.get("input"))));
    const workbook = await readProceduresWorkbook(Buffer.from(await file.arrayBuffer()), input.month, input.correctReversedDates);
    if (form.get("mode") === "preview") return NextResponse.json({ summary: workbook.summary, correctedDates: workbook.correctedDates });
    if (form.get("mode") !== "import") throw new Error("invalidData");
    await importProcedures(shopId, input, workbook.fileHash, workbook.rows);
    return NextResponse.json({ count: workbook.rows.length });
  } catch (error) {
    const known = ["invalidWorkbook", "dateMismatch", "conflict", "alreadyImported", "notFound", "UNAUTHENTICATED", "EDITOR_REQUIRED", "SHOP_ACCESS_REQUIRED"];
    const message = error instanceof Error && known.includes(error.message) ? error.message : "importFailed";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHENTICATED" ? 401 : ["EDITOR_REQUIRED", "SHOP_ACCESS_REQUIRED"].includes(message) ? 403 : message === "conflict" || message === "alreadyImported" ? 409 : 400 });
  }
}
