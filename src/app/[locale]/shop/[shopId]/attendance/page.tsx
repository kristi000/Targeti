import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { AttendancePage } from "@/components/attendance-page";
import { fetchAttendanceMonth } from "@/app/actions/attendance";
import { attendanceMonthSchema } from "@/lib/persistence-schemas";
import { attendanceQueryKey } from "@/lib/attendance";

export default async function ShopAttendancePage({ params, searchParams }: { params: Promise<{ shopId: string }>; searchParams: Promise<{ month?: string }> }) {
  const { shopId } = await params;
  const parameters = await searchParams;
  const current = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Tirane", year: "numeric", month: "2-digit" }).format(new Date());
  const parsed = attendanceMonthSchema.safeParse(parameters.month);
  const month = parsed.success ? parsed.data : current;
  const client = new QueryClient();
  await client.fetchQuery({ queryKey: attendanceQueryKey(shopId, month), queryFn: () => fetchAttendanceMonth(shopId, month) });
  return <HydrationBoundary state={dehydrate(client)}><AttendancePage shopId={shopId} initialMonth={month} /></HydrationBoundary>;
}
