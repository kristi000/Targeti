import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { fetchDailyActivityMonth } from "@/app/actions/daily-activity";
import { DailyActivityPage } from "@/components/daily-activity-page";
import { dailyActivityMonthQueryKey } from "@/lib/daily-activity";
import { attendanceMonthSchema, shopIdSchema } from "@/lib/persistence-schemas";

export default async function ShopDailyActivityPage({ params, searchParams }: { params: Promise<{ shopId: string }>; searchParams: Promise<{ month?: string }> }) {
  const { shopId: requestedShopId } = await params;
  const shopId = shopIdSchema.parse(requestedShopId);
  const parameters = await searchParams;
  const current = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Tirane", year: "numeric", month: "2-digit" }).format(new Date());
  const parsed = attendanceMonthSchema.safeParse(parameters.month);
  const month = parsed.success ? parsed.data : current;
  const client = new QueryClient();
  await client.fetchQuery({ queryKey: dailyActivityMonthQueryKey(shopId, month), queryFn: () => fetchDailyActivityMonth(shopId, month) });
  return <HydrationBoundary state={dehydrate(client)}><DailyActivityPage key={`${shopId}:${month}`} shopId={shopId} initialMonth={month} /></HydrationBoundary>;
}
