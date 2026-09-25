import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentActor } from "@/lib/access";
import { monthSchema } from "@/lib/persistence-schemas";
import { hasRestrictedAccess } from "@/lib/restricted-access";
import { loadAccessibleShops } from "@/lib/shop-directory";
import { readBonusOverviewAllTime, readBonusOverviewMonth } from "@/lib/server/bonus-overview-data";

const querySchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("month"), month: monthSchema }).strict(),
  z.object({ scope: z.literal("all"), months: z.array(monthSchema).min(1).max(120) }).strict(),
]);
const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const actor = await getCurrentActor();
    if (!await hasRestrictedAccess()) return NextResponse.json({ error: "RESTRICTED_ACCESS_REQUIRED" }, { status: 403, headers: privateHeaders });
    const parameters = new URL(request.url).searchParams;
    const scope = parameters.get("scope");
    const input = querySchema.safeParse(scope === "all"
      ? { scope: "all", months: parameters.getAll("month") }
      : { scope, month: parameters.get("month") });
    if (!input.success) return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400, headers: privateHeaders });
    const shopIds = (await loadAccessibleShops(actor)).map(shop => shop.id);
    const data = input.data.scope === "all"
      ? await readBonusOverviewAllTime([...new Set(input.data.months)].sort().reverse(), shopIds)
      : await readBonusOverviewMonth(input.data.month, shopIds);
    return NextResponse.json(data, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401, headers: privateHeaders });
    }
    console.error("Failed to load bonus overview:", error);
    return NextResponse.json({ error: "BONUS_OVERVIEW_FAILED" }, { status: 500, headers: privateHeaders });
  }
}
