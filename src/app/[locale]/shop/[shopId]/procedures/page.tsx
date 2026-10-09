import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { fetchProcedures } from "@/app/actions/procedures";
import { ProceduresPage } from "@/components/procedures-page";
import { attendanceMonthSchema } from "@/lib/persistence-schemas";
import { procedurePageQueryKey } from "@/lib/procedures";

export default async function ShopProceduresPage({ params, searchParams }: { params: Promise<{ shopId: string }>; searchParams: Promise<{ month?: string }> }) {
  const { shopId } = await params;
  const parameters = await searchParams;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Tirane", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const current = today.slice(0, 7);
  const parsed = attendanceMonthSchema.safeParse(parameters.month);
  const month = parsed.success ? parsed.data : current;
  const client = new QueryClient();
  await client.fetchQuery({ queryKey: procedurePageQueryKey(shopId, month), queryFn: () => fetchProcedures(shopId, month) });
  return <HydrationBoundary state={dehydrate(client)}><ProceduresPage shopId={shopId} initialMonth={month} initialDate={month === current ? today : `${month}-01`} /></HydrationBoundary>;
}
