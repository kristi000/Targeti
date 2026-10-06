"use client";

import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, ChevronUp, History, LoaderCircle } from "lucide-react";
import { fetchAttendanceHistory, fetchAttendanceHistoryDetails, fetchAttendanceMonth } from "@/app/actions/attendance";
import { attendanceQueryKey, attendanceText, type AttendanceHistory } from "@/lib/attendance";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function AttendanceHistoryButton({ shopId, month }: { shopId: string; month: string }) {
  const t = useTranslations("Attendance.history");
  const [open, setOpen] = useState(false);
  const attendance = useQuery({ queryKey: attendanceQueryKey(shopId, month), queryFn: () => fetchAttendanceMonth(shopId, month), enabled: open });
  const query = useInfiniteQuery({
    queryKey: ["attendance-history", shopId, month, attendance.data?.config.revision],
    queryFn: ({ pageParam }) => fetchAttendanceHistory(shopId, month, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled: open && Boolean(attendance.data),
  });
  return <>
    <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}><History className="mr-1.5 h-4 w-4" />{t("title")}</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader className="min-w-0"><DialogTitle>{t("title")} · {month}</DialogTitle><DialogDescription>{t("description")}</DialogDescription></DialogHeader>
        {(attendance.isPending || query.isPending) && !attendance.isError && <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p>}
        {(attendance.isError || query.isError) && <div role="alert"><p className="text-sm text-destructive">{t("failed")}</p><Button size="sm" variant="outline" onClick={() => { void attendance.refetch(); void query.refetch(); }}>{t("retry")}</Button></div>}
        {query.data && !query.data.pages[0].items.length && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
        <div className="min-w-0 space-y-3">{query.data?.pages.flatMap(page => page.items).map(item => <HistoryRecord key={item.id} shopId={shopId} month={month} item={item} />)}</div>
        {query.hasNextPage && <Button variant="outline" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage && <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" />}{t("loadMore")}</Button>}
      </DialogContent>
    </Dialog>
  </>;
}

function HistoryRecord({ shopId, month, item }: { shopId: string; month: string; item: AttendanceHistory }) {
  const t = useTranslations("Attendance.history");
  const attendanceTranslations = useTranslations("Attendance");
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  const query = useQuery({ queryKey: ["attendance-history-details", shopId, month, item.id], queryFn: () => fetchAttendanceHistoryDetails(shopId, month, item.id), enabled: expanded, staleTime: Infinity });
  const timestamp = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Tirane" }).format(new Date(item.createdAt));
  const panelId = `attendance-history-${item.id}`;
  return <section className="min-w-0 rounded-lg border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><p className="text-sm font-semibold">{item.actorName} · {t(item.source)}</p><p className="text-xs text-muted-foreground">{timestamp} · {t("dates", { count: item.dates.length })}</p></div>
      <Button type="button" size="sm" variant="ghost" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(value => !value)}>{expanded ? <ChevronUp className="mr-1.5 h-4 w-4" /> : <ChevronDown className="mr-1.5 h-4 w-4" />}{t(expanded ? "hide" : "details")}</Button>
    </div>
    {item.templateChanged && <p className="mt-1 text-xs text-muted-foreground">{t("templateChanged")}</p>}
    <div id={panelId} hidden={!expanded} className="mt-3 space-y-3">
      {query.isPending && <p className="text-sm text-muted-foreground">{t("loading")}</p>}
      {query.isError && <div role="alert"><p className="text-sm text-destructive">{t("failed")}</p><Button size="sm" variant="outline" onClick={() => void query.refetch()}>{t("retry")}</Button></div>}
      {query.data?.map(detail => <div key={detail.kind === "day" ? detail.date : "roster"} className="overflow-x-auto">
        <p className="mb-1 text-sm font-medium">{detail.kind === "day" ? detail.date : t("staff")}</p>
        <table className="w-full min-w-80 table-fixed text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="p-2">{t("person")}</th><th className="p-2">{t("before")}</th><th className="p-2">{t("after")}</th></tr></thead><tbody>
          {detail.kind === "day" ? detail.changes.map(change => <tr key={change.staffId} className="border-b last:border-0"><th className="break-words p-2 text-left font-medium">{change.name}</th><td className="whitespace-pre-wrap break-words p-2">{change.before ? attendanceText(change.before) : attendanceTranslations("notEntered")}</td><td className="whitespace-pre-wrap break-words p-2">{change.after ? attendanceText(change.after) : attendanceTranslations("notEntered")}</td></tr>) : detail.changes.map(change => <tr key={change.after?.id ?? change.before?.id} className="border-b last:border-0"><th className="break-words p-2 text-left font-medium">{change.after?.name ?? change.before?.name}</th><td className="break-words p-2">{change.before ? `${change.before.name} (${change.before.role})` : "—"}</td><td className="break-words p-2">{change.after ? `${change.after.name} (${change.after.role})` : "—"}</td></tr>)}
        </tbody></table>
      </div>)}
    </div>
  </section>;
}
