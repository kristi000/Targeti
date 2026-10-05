"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { BriefcaseBusiness, CalendarDays, LoaderCircle, RotateCcw, Save } from "lucide-react";
import { fetchAttendanceMonth, handleSaveAttendance } from "@/app/actions/attendance";
import { ATTENDANCE_CODES, attendanceQueryKey, monthDates, type AttendanceEntry, type AttendanceMonth } from "@/lib/attendance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type DraftDay = { entries: AttendanceEntry[]; expectedUpdatedAt: string | null };
type Draft = { revision: number; days: Record<string, DraftDay> };
type Props = { shopId: string; month: string; canEdit: boolean; date?: string; locked?: boolean; onDirtyChange?: (dirty: boolean) => void };
export function AttendanceEditor(props: Props) {
  const t = useTranslations("Attendance");
  const query = useQuery({ queryKey: attendanceQueryKey(props.shopId, props.month), queryFn: () => fetchAttendanceMonth(props.shopId, props.month) });
  if (query.isPending) return <p role="status" className="p-4 text-sm text-muted-foreground">{t("loading")}</p>;
  if (query.isError) return <div role="alert" className="p-4"><p>{t("loadFailed")}</p><Button variant="outline" onClick={() => void query.refetch()}>{t("reload")}</Button></div>;
  return <AttendanceGrid {...props} data={query.data} />;
}
export function AttendanceManagerName({ shopId, month }: Pick<Props, "shopId" | "month">) {
  const t = useTranslations("Attendance");
  const query = useQuery({ queryKey: attendanceQueryKey(shopId, month), queryFn: () => fetchAttendanceMonth(shopId, month) });
  return <>{query.data?.config.staff.filter(person => person.role === "SM").map(manager => <span key={manager.id} className="inline-flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary/10 px-2.5 py-1 text-sm font-semibold text-primary dark:text-purple-300"><BriefcaseBusiness className="h-4 w-4" />{manager.name}<span className="text-xs font-normal">{t("manager")}</span></span>)}</>;
}
function AttendanceGrid({ shopId, month, canEdit, date, locked, onDirtyChange, data }: Props & { data: AttendanceMonth }) {
  const t = useTranslations("Attendance");
  const locale = useLocale();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [undo, setUndo] = useState<(Draft | null)[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkCode, setBulkCode] = useState<AttendanceEntry["code"]>("1");
  const [bulkStaffId, setBulkStaffId] = useState("");
  const [bulkNote, setBulkNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ date: string; staffId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { onDirtyChange?.(Boolean(draft) || busy); }, [draft, busy, onDirtyChange]);
  useEffect(() => {
    if (!draft) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [draft]);
  const dates = date ? [date] : monthDates(month);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Tirane", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const isLocked = (day: string) => locked || data.lockedDates.includes(day);
  const dayValue = (day: string): DraftDay => draft?.days[day] ?? { entries: data.days.find(item => item.date === day)?.entries ?? [], expectedUpdatedAt: data.days.find(item => item.date === day)?.updatedAt ?? null };
  const changeDays = (updates: Record<string, DraftDay>) => {
    setUndo(previous => [...previous.slice(-9), draft]);
    setDraft(previous => ({ revision: previous?.revision ?? data.config.revision, days: { ...previous?.days, ...updates } }));
    setError(null);
  };
  const changeEntry = (day: string, staffId: string, code: string, note = "") => {
    if (isLocked(day) || !canEdit) return;
    const current = dayValue(day);
    const entries = current.entries.filter(entry => entry.staffId !== staffId);
    if (code) entries.push({ staffId, code: code as AttendanceEntry["code"], note });
    changeDays({ [day]: { ...current, entries } });
  };
  const save = async () => {
    if (!draft) return;
    const savedDraft = draft;
    setBusy(true);
    try {
      const result = await handleSaveAttendance({ shopId, month, expectedRevision: savedDraft.revision,
        changes: Object.entries(savedDraft.days).map(([day, value]) => ({ date: day, ...value })),
      });
      if (!result.success) { setError(result.error); return; }
      queryClient.setQueryData(attendanceQueryKey(shopId, month), result.data);
      setDraft(null); setUndo([]); setEditing(null); setError(null);
      toast({ title: t("saved") });
    } catch { setError("saveFailed"); }
    finally { setBusy(false); }
  };
  const formatDate = (day: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  const managers = data.config.staff.filter(person => person.role === "SM");
  if (!data.config.staff.length) return <p className="p-4 text-sm text-muted-foreground">{t("noStaff")}</p>;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" /><span className="text-sm font-semibold">{date ? t("staffToday") : t("monthlyRoster")}</span>{managers.map(manager => <span key={manager.id} className="inline-flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary/10 px-2.5 py-1 text-sm font-semibold text-primary dark:text-purple-300"><BriefcaseBusiness className="h-4 w-4" />{manager.name}<span className="text-xs font-normal">{t("manager")}</span></span>)}</div>
    </div>
    {!date && canEdit && <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-2">
      <span className="text-xs text-muted-foreground">{t("selectedDates", { count: selected.length })}</span>
      <select aria-label={t("applyTo")} value={bulkStaffId} disabled={busy} onChange={event => setBulkStaffId(event.target.value)} className="h-9 max-w-52 rounded-md border bg-background px-2 text-sm"><option value="">{t("allStaff")}</option>{data.config.staff.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
      <select aria-label={t("bulkCode")} value={bulkCode} disabled={busy} onChange={event => setBulkCode(event.target.value as AttendanceEntry["code"])} className="h-9 rounded-md border bg-background px-2 text-sm">{ATTENDANCE_CODES.map(code => <option key={code} value={code}>{t(`codes.${code}`)}</option>)}</select>
      <Input value={bulkNote} onChange={event => setBulkNote(event.target.value)} maxLength={200} disabled={busy} placeholder={t("notePlaceholder")} aria-label={t("note")} className="h-9 max-w-56" />
      <Button size="sm" variant="outline" disabled={busy || !selected.length || bulkCode === "OTHER" && !bulkNote.trim()} onClick={() => {
        const updates = Object.fromEntries(selected.filter(day => !isLocked(day)).map(day => {
          const current = dayValue(day);
          const affected = data.config.staff.filter(person => !bulkStaffId || person.id === bulkStaffId);
          return [day, { ...current, entries: [...current.entries.filter(entry => !affected.some(person => person.id === entry.staffId)), ...affected.map(person => ({ staffId: person.id, code: bulkCode, note: bulkNote.trim() }))] }];
        }));
        if (Object.keys(updates).length) changeDays(updates);
      }}>{t("applySelected")}</Button>
      <Button size="sm" variant="outline" disabled={busy || !selected.length} onClick={() => {
        const updates: Record<string, DraftDay> = {};
        for (const day of selected) {
          const previous = new Date(`${day}T12:00:00Z`); previous.setUTCDate(previous.getUTCDate() - 7);
          const previousDate = previous.toISOString().slice(0, 10);
          if (previousDate.startsWith(month) && !isLocked(day)) {
            const copied = dayValue(previousDate).entries.filter(entry => !bulkStaffId || entry.staffId === bulkStaffId).map(entry => ({ staffId: entry.staffId, code: entry.code, note: entry.note }));
            updates[day] = { ...dayValue(day), entries: [...dayValue(day).entries.filter(entry => bulkStaffId && entry.staffId !== bulkStaffId), ...copied] };
          }
        }
        if (Object.keys(updates).length) changeDays(updates);
      }}>{t("copyPreviousWeek")}</Button>
    </div>}
    <div className="max-h-[65vh] overflow-auto rounded-lg border">
      <table className="w-max min-w-full border-collapse text-sm">
        <thead className="sticky top-0 z-[2] bg-muted"><tr>
          <th className="sticky left-0 z-[3] min-w-40 border-b border-r bg-muted px-3 py-2 text-left">{t("date")}</th>
          {data.config.staff.map(person => <th key={person.id} className={cn("min-w-36 max-w-52 border-b border-r px-3 py-2 text-center", person.role === "SM" && "bg-primary/10")}><div className={cn("flex items-center justify-center gap-1 font-semibold", person.role === "SM" && "text-primary dark:text-purple-300")}>{person.role === "SM" && <BriefcaseBusiness className="h-3.5 w-3.5 shrink-0" />}<span>{person.name}</span></div><span className="text-[11px] font-normal text-muted-foreground">{person.role === "SM" ? t("manager") : person.role}</span></th>)}
        </tr></thead>
        <tbody>{dates.map(day => {
          const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
          const current = dayValue(day);
          const readOnly = !canEdit || Boolean(isLocked(day)) || busy;
          return <tr key={day} className={cn("border-b last:border-b-0", [0, 6].includes(weekday) && "bg-muted/25", day === today && "bg-primary/[0.06]")}>
            <th className="sticky left-0 z-[1] border-r bg-background px-3 py-2 text-left font-medium"><div className="flex items-center gap-2">{!date && canEdit && <input type="checkbox" aria-label={t("selectDate", { date: formatDate(day) })} disabled={readOnly} checked={selected.includes(day)} onChange={event => setSelected(previous => event.target.checked ? [...previous, day] : previous.filter(value => value !== day))} />}<span>{formatDate(day)}{day === today && <span className="ml-1 text-xs text-primary">{t("today")}</span>}</span></div></th>
            {data.config.staff.map(person => {
              const entry = current.entries.find(value => value.staffId === person.id);
              const editNote = editing?.date === day && editing.staffId === person.id;
              return <td key={person.id} className={cn("border-r px-2 py-1.5 text-center", person.role === "SM" && "bg-primary/[0.04]")}>
                <select aria-label={t("chooseFor", { name: person.name, date: formatDate(day) })} value={entry?.code ?? ""} disabled={readOnly} className={cn("h-9 w-full max-w-44 rounded border bg-background px-1 text-center text-sm", entry?.code === "LV" && "bg-amber-50 text-amber-900", entry?.code === "R" && "bg-red-50 text-red-900", entry?.code === "P" && "bg-muted", entry?.code === "OTHER" && "bg-blue-50 text-blue-900")} onChange={event => {
                  const code = event.target.value;
                  changeEntry(day, person.id, code, entry?.note ?? "");
                  if (code === "OTHER") setEditing({ date: day, staffId: person.id });
                }}><option value="">{t("notEntered")}</option>{ATTENDANCE_CODES.map(code => <option key={code} value={code}>{t(`codes.${code}`)}</option>)}</select>
                {editNote || entry?.code === "OTHER" && !entry.note ? <Input aria-label={t("noteFor", { name: person.name })} className="mt-1 h-8 max-w-44 text-xs" disabled={readOnly} maxLength={200} value={entry?.note ?? ""} onChange={event => changeEntry(day, person.id, entry?.code ?? "OTHER", event.target.value)} /> : <button type="button" disabled={readOnly || !entry} className="mt-0.5 block w-full max-w-44 truncate text-[11px] text-muted-foreground disabled:cursor-default" title={entry?.note || t("addNote")} onClick={() => setEditing({ date: day, staffId: person.id })}>{entry?.note || (entry && !readOnly ? t("addNote") : "")}</button>}
              </td>;
            })}
          </tr>;
        })}</tbody>
        {!date && <tfoot><tr className="bg-muted/40"><th className="sticky left-0 bg-muted px-3 py-2 text-left text-xs">{t("totals")}</th>{data.config.staff.map(person => {
          const entries = dates.flatMap(day => dayValue(day).entries.filter(entry => entry.staffId === person.id));
          return <td key={person.id} className="px-3 py-2 text-center text-xs">{["1", "2", "P", "LV", "R"].map(code => `${code}: ${entries.filter(entry => entry.code === code || entry.code === "1+2" && (code === "1" || code === "2")).length}`).join(" · ")}</td>;
        })}</tr></tfoot>}
      </table>
    </div>
    <p className="text-xs text-muted-foreground">{date ? t("dailyHint") : t("gridHint")}</p>
    {date && data.config.staff.some(person => !dayValue(date).entries.some(entry => entry.staffId === person.id)) && <p className="text-xs text-amber-700 dark:text-amber-300">{t("missingReminder")}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{t(`errors.${error}`)}</p>}
    {canEdit && <div className="flex flex-wrap justify-end gap-2"><Button size="sm" variant="ghost" disabled={busy || !undo.length} onClick={() => { setDraft(undo[undo.length - 1]); setUndo(previous => previous.slice(0, -1)); }}><RotateCcw className="mr-1.5 h-4 w-4" />{t("undo")}</Button><Button size="sm" variant="outline" disabled={busy || !draft} onClick={() => { setDraft(null); setUndo([]); setError(null); setEditing(null); void queryClient.invalidateQueries({ queryKey: attendanceQueryKey(shopId, month) }); }}>{t("cancel")}</Button><Button size="sm" disabled={busy || !draft || Object.values(draft.days).some(day => day.entries.some(entry => entry.code === "OTHER" && !entry.note.trim()))} onClick={() => void save()}>{busy ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}{t("save")}</Button></div>}
  </div>;
}
