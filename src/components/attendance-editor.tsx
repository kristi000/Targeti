"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, BriefcaseBusiness, ChevronDown, LoaderCircle, Plus, RotateCcw, Save } from "lucide-react";
import { fetchAttendanceMonth, handleSaveAttendance } from "@/app/actions/attendance";
import { ATTENDANCE_CODES, attendanceQueryKey, monthDates, type AttendanceEntry, type AttendanceMonth, type AttendanceStaff } from "@/lib/attendance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type DraftDay = { entries: AttendanceEntry[]; expectedUpdatedAt: string | null };
type Draft = { revision: number; days: Record<string, DraftDay>; staff?: AttendanceStaff[] };

const attendanceColors: Record<AttendanceEntry["code"], string> = {
  "1": "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  "2": "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  "1+2": "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
  P: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
  LV: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  R: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
  OTHER: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
};

function columnLetter(index: number): string {
  let result = "";
  for (let number = index + 1; number > 0; number = Math.floor((number - 1) / 26)) {
    result = String.fromCharCode(65 + (number - 1) % 26) + result;
  }
  return result;
}
type Props = { shopId: string; month: string; canEdit: boolean; date?: string; onDirtyChange?: (dirty: boolean) => void };
export function AttendanceEditor(props: Props) {
  const t = useTranslations("Attendance");
  const query = useQuery({ queryKey: attendanceQueryKey(props.shopId, props.month), queryFn: () => fetchAttendanceMonth(props.shopId, props.month) });
  if (query.isPending) return <p role="status" className="p-4 text-sm text-muted-foreground">{t("loading")}</p>;
  if (query.isError) return <div role="alert" className="p-4"><p>{t("loadFailed")}</p><Button variant="outline" onClick={() => void query.refetch()}>{t("reload")}</Button></div>;
  return <AttendanceGrid {...props} data={query.data} />;
}
function AttendanceGrid({ shopId, month, canEdit, date, onDirtyChange, data }: Props & { data: AttendanceMonth }) {
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
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { onDirtyChange?.(Boolean(draft) || busy); }, [draft, busy, onDirtyChange]);
  useEffect(() => {
    if (!draft) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [draft]);
  const dates = date ? [date] : monthDates(month);
  const staff = draft?.staff ?? data.config.staff;
  const changeStaff = (next: AttendanceStaff[]) => {
    if (!canEdit || busy || date) return;
    setUndo(previous => [...previous.slice(-9), draft]);
    setDraft(previous => ({ revision: previous?.revision ?? data.config.revision, days: previous?.days ?? {}, staff: next }));
    setError(null);
  };
  const moveStaff = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= staff.length) return;
    const next = [...staff];
    [next[index], next[target]] = [next[target], next[index]];
    changeStaff(next);
  };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Tirane", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const dayValue = (day: string): DraftDay => draft?.days[day] ?? { entries: data.days.find(item => item.date === day)?.entries ?? [], expectedUpdatedAt: data.days.find(item => item.date === day)?.updatedAt ?? null };
  const changeDays = (updates: Record<string, DraftDay>) => {
    setUndo(previous => [...previous.slice(-9), draft]);
    setDraft(previous => ({ ...previous, revision: previous?.revision ?? data.config.revision, days: { ...previous?.days, ...updates } }));
    setError(null);
  };
  const changeEntry = (day: string, staffId: string, code: string, note = "") => {
    if (!canEdit) return;
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
        ...(savedDraft.staff ? { staff: savedDraft.staff } : {}),
        changes: Object.entries(savedDraft.days).map(([day, value]) => ({ date: day, ...value })),
      });
      if (!result.success) { setError(result.error); return; }
      queryClient.setQueryData(attendanceQueryKey(shopId, month), result.data);
      setDraft(null); setUndo([]); setError(null);
      toast({ title: t("saved") });
    } catch { setError("saveFailed"); }
    finally { setBusy(false); }
  };
  const formatDate = (day: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  const invalidDraft = staff.some(person => !person.name.trim()) || Object.values(draft?.days ?? {}).some(day => day.entries.some(entry => entry.code === "OTHER" && !entry.note.trim()));
  const editControls = canEdit && <div className="flex flex-wrap items-center gap-1">
    {!date && <Button size="sm" className="h-7 px-2 text-xs" variant="outline" disabled={busy || staff.length >= 50} onClick={() => changeStaff([...staff, { id: crypto.randomUUID(), name: "", role: "SR" }])}><Plus className="mr-1.5 h-4 w-4" />{t("addStaff")}</Button>}
    <Button size="sm" className="h-7 px-2 text-xs" variant="ghost" disabled={busy || !undo.length} onClick={() => { setDraft(undo[undo.length - 1]); setUndo(previous => previous.slice(0, -1)); }}><RotateCcw className="mr-1.5 h-4 w-4" />{t("undo")}</Button>
    <Button size="sm" className="h-7 px-2 text-xs" variant="outline" disabled={busy || !draft} onClick={() => { setDraft(null); setUndo([]); setError(null); void queryClient.invalidateQueries({ queryKey: attendanceQueryKey(shopId, month) }); }}>{t("cancel")}</Button>
    <Button size="sm" className="h-7 px-2 text-xs" disabled={busy || !draft || invalidDraft} onClick={() => void save()}>{busy ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}{t("save")}</Button>
  </div>;
  return <div className="space-y-2">
    {canEdit && <div className="flex flex-wrap items-center justify-end gap-1">{editControls}</div>}
    {!date && canEdit && <div className="flex flex-wrap items-center gap-2 rounded-sm border bg-muted/20 p-2">
      <span className="text-xs text-muted-foreground">{t("selectedDates", { count: selected.length })}</span>
      <select aria-label={t("applyTo")} value={bulkStaffId} disabled={busy} onChange={event => setBulkStaffId(event.target.value)} className="h-9 max-w-52 rounded-md border bg-background px-2 text-sm"><option value="">{t("allStaff")}</option>{staff.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
      <select aria-label={t("bulkCode")} value={bulkCode} disabled={busy} onChange={event => setBulkCode(event.target.value as AttendanceEntry["code"])} className={cn("h-9 rounded-md border px-2 text-sm", attendanceColors[bulkCode])}>{ATTENDANCE_CODES.map(code => <option key={code} value={code}>{t(`codes.${code}`)}</option>)}</select>
      <Input value={bulkNote} onChange={event => setBulkNote(event.target.value)} maxLength={200} disabled={busy} placeholder={t("notePlaceholder")} aria-label={t("note")} className="h-9 max-w-56" />
      <Button size="sm" className="h-7 px-2 text-xs" variant="outline" disabled={busy || !selected.length || bulkCode === "OTHER" && !bulkNote.trim()} onClick={() => {
        const updates = Object.fromEntries(selected.map(day => {
          const current = dayValue(day);
          const affected = staff.filter(person => !bulkStaffId || person.id === bulkStaffId);
          return [day, { ...current, entries: [...current.entries.filter(entry => !affected.some(person => person.id === entry.staffId)), ...affected.map(person => ({ staffId: person.id, code: bulkCode, note: bulkNote.trim() }))] }];
        }));
        if (Object.keys(updates).length) changeDays(updates);
      }}>{t("applySelected")}</Button>
      <Button size="sm" className="h-7 px-2 text-xs" variant="outline" disabled={busy || !selected.length} onClick={() => {
        const updates: Record<string, DraftDay> = {};
        for (const day of selected) {
          const previous = new Date(`${day}T12:00:00Z`); previous.setUTCDate(previous.getUTCDate() - 7);
          const previousDate = previous.toISOString().slice(0, 10);
          if (previousDate.startsWith(month)) {
            const copied = dayValue(previousDate).entries.filter(entry => !bulkStaffId || entry.staffId === bulkStaffId).map(entry => ({ staffId: entry.staffId, code: entry.code, note: entry.note }));
            updates[day] = { ...dayValue(day), entries: [...dayValue(day).entries.filter(entry => bulkStaffId && entry.staffId !== bulkStaffId), ...copied] };
          }
        }
        if (Object.keys(updates).length) changeDays(updates);
      }}>{t("copyPreviousWeek")}</Button>
    </div>}
    <div className="overflow-hidden rounded-sm border border-slate-300 [--sheet-line:#d1d5db] dark:border-slate-600 dark:[--sheet-line:#475569]">
    <details className="group border-b border-[var(--sheet-line)] bg-background text-[10px]">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 px-2 py-1 font-medium text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 [&::-webkit-details-marker]:hidden"><ChevronDown aria-hidden="true" className="h-3 w-3 transition-transform group-open:rotate-180" />{t("colorLegend")}</summary>
      <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1.5">
      {ATTENDANCE_CODES.map(code => <span key={code} className={cn("rounded-sm px-1.5 py-0.5 font-medium ring-1 ring-inset ring-black/10 dark:ring-white/15", attendanceColors[code])}>{t(`codes.${code}`)}</span>)}
      <span className="rounded-sm border bg-background px-1.5 py-0.5 text-muted-foreground">{t("notEntered")}</span>
      {!date && <span className="rounded-sm border border-orange-300 bg-orange-50 px-1.5 py-0.5 font-medium text-orange-800 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-200">{t("sunday")}</span>}
      </div>
    </details>
    <div className="max-h-[65vh] overflow-auto">
      <table aria-label={date ? t("staffToday") : t("monthlyRoster")} style={{ width: 176 + staff.length * 144 }} className="table-fixed border-separate border-spacing-0 bg-background text-xs">
        <colgroup><col className="w-8" /><col className="w-36" />{staff.map(person => <col key={person.id} />)}</colgroup>
        <thead className="sticky top-0 z-20">
          <tr className="h-5 bg-slate-100 text-[11px] font-normal text-slate-500 dark:bg-slate-800 dark:text-slate-300">
            <th aria-hidden="true" className="sticky left-0 z-30 border-b border-r border-[var(--sheet-line)] bg-slate-100 dark:bg-slate-800" />
            <th scope="col" className="sticky left-8 z-30 border-b border-r border-[var(--sheet-line)] bg-slate-100 font-normal dark:bg-slate-800">A</th>
            {staff.map((person, index) => <th key={person.id} scope="col" className="border-b border-r border-[var(--sheet-line)] font-normal">
              <div className="flex items-center justify-between px-1">
                {!date && canEdit && <Button type="button" size="icon" variant="ghost" className="h-6 w-6 rounded-none" aria-label={t("moveColumnLeft", { name: person.name || t("staffName") })} title={t("moveColumnLeft", { name: person.name || t("staffName") })} disabled={busy || index === 0} onClick={() => moveStaff(index, -1)}><ArrowLeft className="h-3 w-3" /></Button>}
                <span className="flex-1">{columnLetter(index + 1)}</span>
                {!date && canEdit && <Button type="button" size="icon" variant="ghost" className="h-6 w-6 rounded-none" aria-label={t("moveColumnRight", { name: person.name || t("staffName") })} title={t("moveColumnRight", { name: person.name || t("staffName") })} disabled={busy || index === staff.length - 1} onClick={() => moveStaff(index, 1)}><ArrowRight className="h-3 w-3" /></Button>}
              </div>
            </th>)}
          </tr>
          <tr className="bg-slate-50 dark:bg-slate-900">
            <th aria-hidden="true" className="sticky left-0 z-30 border-b border-r border-[var(--sheet-line)] bg-slate-100 font-normal text-slate-500 dark:bg-slate-800">1</th>
            <th scope="col" className="sticky left-8 z-30 border-b border-r border-[var(--sheet-line)] bg-slate-50 px-3 text-left font-semibold dark:bg-slate-900">{t("date")}</th>
            {staff.map((person, index) => <th key={person.id} scope="col" className={cn("w-36 min-w-36 border-b border-r border-[var(--sheet-line)] p-0 text-center", person.role === "SM" && "bg-emerald-50 dark:bg-emerald-950")}>
              {!date && canEdit ? <>
                <input aria-label={t("staffNameColumn", { column: columnLetter(index + 1) })} title={person.name || t("staffName")} placeholder={t("staffName")} value={person.name} maxLength={120} disabled={busy} className="h-7 w-full min-w-0 border-0 bg-transparent px-2 text-center font-semibold outline-none focus:bg-background focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-emerald-600 disabled:opacity-70" onChange={event => changeStaff(staff.map(item => item.id === person.id ? { ...item, name: event.target.value } : item))} />
                <select aria-label={t("staffRoleColumn", { column: columnLetter(index + 1) })} title={person.role === "SM" ? t("manager") : person.role} value={person.role} disabled={busy} className="h-6 w-full border-0 border-t border-[var(--sheet-line)] bg-transparent px-2 text-center text-[11px] font-normal outline-none focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-emerald-600" onChange={event => changeStaff(staff.map(item => item.id === person.id ? { ...item, role: event.target.value as AttendanceStaff["role"] } : item))}><option value="SM">SM · {t("manager")}</option><option value="SR">SR</option><option value="IE">IE</option></select>
              </> : <div className="px-1.5 py-1"><div className="flex items-center justify-center gap-1 font-semibold">{person.role === "SM" && <BriefcaseBusiness className="h-3.5 w-3.5 shrink-0" />}<span className="max-w-32 truncate" title={person.name}>{person.name}</span></div><span className="text-[11px] font-normal text-muted-foreground">{person.role === "SM" ? `SM · ${t("manager")}` : person.role}</span></div>}
            </th>)}
          </tr>
        </thead>
        <tbody>{dates.map((day, index) => {
          const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
          const current = dayValue(day);
          const readOnly = !canEdit || busy;
          return <tr key={day} className={cn("group", weekday === 6 && "bg-slate-50 dark:bg-slate-900/50", weekday === 0 && "bg-orange-50 dark:bg-orange-950/30", selected.includes(day) && "bg-emerald-50 dark:bg-emerald-950/40", day === today && "bg-emerald-50/60 dark:bg-emerald-950/20")}>
            <td aria-hidden="true" className={cn("sticky left-0 z-10 border-b border-r border-[var(--sheet-line)] bg-slate-100 px-2 text-center tabular-nums text-slate-500 dark:bg-slate-800", weekday === 0 && "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200")}>{index + 2}</td>
            <th scope="row" className={cn("sticky left-8 z-10 border-b border-r border-[var(--sheet-line)] bg-background px-2 py-1 text-left font-normal whitespace-nowrap", weekday === 0 && "border-l-2 border-l-orange-400 bg-orange-50 font-medium text-orange-800 dark:bg-orange-950 dark:text-orange-200", selected.includes(day) && "bg-emerald-50 dark:bg-emerald-950", day === today && "font-semibold text-emerald-700 dark:text-emerald-300")}><div className="flex items-center gap-2">{!date && canEdit && <input type="checkbox" className="accent-emerald-600" aria-label={t("selectDate", { date: formatDate(day) })} disabled={readOnly} checked={selected.includes(day)} onChange={event => setSelected(previous => event.target.checked ? [...previous, day] : previous.filter(value => value !== day))} />}<span>{formatDate(day)}{day === today && <span className="ml-1 text-[10px]">{t("today")}</span>}</span></div></th>
            {staff.map(person => {
              const entry = current.entries.find(value => value.staffId === person.id);
              return <td key={person.id} className={cn("border-b border-r border-[var(--sheet-line)] p-0 text-center focus-within:relative focus-within:z-[5] focus-within:outline focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-emerald-600", person.role === "SM" && "bg-emerald-50/30 dark:bg-emerald-950/20", weekday === 0 && "bg-orange-50 dark:bg-orange-950/30", entry && attendanceColors[entry.code])}>
                <select aria-label={t("chooseFor", { name: person.name, date: formatDate(day) })} title={entry ? t(`codes.${entry.code}`) : t("notEntered")} value={entry?.code ?? ""} disabled={readOnly} className="h-7 w-full appearance-none rounded-none border-0 bg-transparent px-2 text-center text-xs font-medium text-inherit outline-none hover:bg-black/[0.03] focus:bg-black/[0.03] disabled:opacity-100 dark:hover:bg-white/[0.04] dark:focus:bg-white/[0.04]" onChange={event => {
                  const code = event.target.value;
                  changeEntry(day, person.id, code, entry?.note ?? "");
                }}><option value="" label=" ">{t("notEntered")}</option>{ATTENDANCE_CODES.map(code => <option key={code} value={code}>{code === "OTHER" ? t("codes.OTHER") : code}</option>)}</select>
                {entry?.code === "OTHER" ? <Input aria-label={t("noteFor", { name: person.name })} className="h-7 w-full rounded-none border-0 border-t bg-transparent px-2 text-xs text-inherit shadow-none focus-visible:ring-0" disabled={readOnly} maxLength={200} value={entry.note} onChange={event => changeEntry(day, person.id, "OTHER", event.target.value)} /> : entry?.note && <p className="max-w-44 truncate px-2 pb-1 text-[10px] text-inherit" title={entry.note}>{entry.note}</p>}
              </td>;
            })}
          </tr>;
        })}</tbody>
        {!date && <tfoot className="sticky bottom-0 z-[15]"><tr className="bg-slate-100 dark:bg-slate-800"><td aria-hidden="true" className="sticky left-0 z-20 border-r border-[var(--sheet-line)] bg-slate-100 px-2 text-center text-slate-500 dark:bg-slate-800">{dates.length + 2}</td><th scope="row" className="sticky left-8 z-20 border-r border-[var(--sheet-line)] bg-slate-100 px-2 py-1 text-left text-xs dark:bg-slate-800">{t("totals")}</th>{staff.map(person => {
          const entries = dates.flatMap(day => dayValue(day).entries.filter(entry => entry.staffId === person.id));
          return <td key={person.id} className="border-r border-[var(--sheet-line)] px-2 py-1 text-center text-[10px] tabular-nums">{["1", "2", "P", "LV", "R"].map(code => `${code}: ${entries.filter(entry => entry.code === code || entry.code === "1+2" && (code === "1" || code === "2")).length}`).join(" · ")}</td>;
        })}</tr></tfoot>}
      </table>
    </div>
    </div>
    {!staff.length && <p className="text-sm text-muted-foreground">{t("noStaff")}</p>}
    {!date && canEdit && <p className="text-xs text-muted-foreground">{t("editGridHint")}</p>}
    <p className="text-xs text-muted-foreground">{date ? t("dailyHint") : t("gridHint")}</p>
    {date && staff.some(person => !dayValue(date).entries.some(entry => entry.staffId === person.id)) && <p className="text-xs text-amber-700 dark:text-amber-300">{t("missingReminder")}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{t(`errors.${error}`)}</p>}
  </div>;
}
