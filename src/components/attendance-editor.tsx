"use client";
import { memo, useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, BriefcaseBusiness, ChevronDown, LoaderCircle, Plus, RotateCcw, Save, X } from "lucide-react";
import { fetchAttendanceMonth, handleSaveAttendance } from "@/app/actions/attendance";
import { ATTENDANCE_CODES, attendanceQueryKey, monthDates, type AttendanceEntry, type AttendanceMonth, type AttendanceStaff } from "@/lib/attendance";
import { Button } from "@/components/ui/button";
import { AppSelect, type AppSelectOption } from "@/components/ui/app-select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type DraftDay = { entries: AttendanceEntry[]; expectedUpdatedAt: string | null };
type Draft = { revision: number; days: Record<string, DraftDay>; staff?: AttendanceStaff[] };
type DraftState = { draft: Draft | null; undo: (Draft | null)[] };
type DraftAction = { type: "edit"; update: (draft: Draft | null) => Draft } | { type: "undo" } | { type: "reset" };
type AttendanceTranslate = ReturnType<typeof useTranslations<"Attendance">>;
type StaffColumn = { person: AttendanceStaff; displayName: string };
type CalendarDay = { date: string; weekday: number; formatted: string };

const EMPTY_DAY: DraftDay = { entries: [], expectedUpdatedAt: null };
const EMPTY_DRAFT_STATE: DraftState = { draft: null, undo: [] };
const TOTAL_CODES = ["1", "2", "P", "LV", "R"] as const;

function draftReducer(state: DraftState, action: DraftAction): DraftState {
  if (action.type === "reset") return EMPTY_DRAFT_STATE;
  if (action.type === "undo") {
    if (!state.undo.length) return state;
    return { draft: state.undo[state.undo.length - 1], undo: state.undo.slice(0, -1) };
  }
  return { draft: action.update(state.draft), undo: [...state.undo.slice(-9), state.draft] };
}

function attendanceTotals(dates: readonly string[], dayValue: (date: string) => DraftDay) {
  const totals = new Map<string, Record<typeof TOTAL_CODES[number], number>>();
  for (const date of dates) {
    for (const entry of dayValue(date).entries) {
      let counts = totals.get(entry.staffId);
      if (!counts) {
        counts = { "1": 0, "2": 0, P: 0, LV: 0, R: 0 };
        totals.set(entry.staffId, counts);
      }
      if (entry.code === "1+2") { counts["1"]++; counts["2"]++; }
      else if (entry.code !== "OTHER") counts[entry.code]++;
    }
  }
  return totals;
}

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

type EntryChange = (day: string, staffId: string, code: string, note?: string) => void;
type CellProps = {
  day: CalendarDay;
  person: AttendanceStaff;
  displayName: string;
  entry?: AttendanceEntry;
  readOnly: boolean;
  options: readonly AppSelectOption[];
  t: AttendanceTranslate;
  onEntryChange: EntryChange;
};

const AttendanceCell = memo(function AttendanceCell({ day, person, displayName, entry, readOnly, options, t, onEntryChange }: CellProps) {
  return <td className={cn("border-b border-r border-[var(--sheet-line)] p-0 text-center focus-within:relative focus-within:z-[5] focus-within:outline focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-emerald-600", person.role === "SM" && "bg-emerald-50/30 dark:bg-emerald-950/20", day.weekday === 0 && "bg-orange-50 dark:bg-orange-950/30", entry && attendanceColors[entry.code])}>
    <AppSelect aria-label={t("chooseFor", { name: displayName, date: day.formatted })} title={entry ? t(`codes.${entry.code}`) : t("notEntered")} value={entry?.code ?? ""} disabled={readOnly} className="relative h-7 justify-center rounded-none border-0 bg-transparent px-3 py-0 text-center text-xs font-medium text-inherit shadow-none hover:bg-black/[0.03] focus:bg-black/[0.03] focus:ring-inset focus:ring-emerald-600 focus:ring-offset-0 disabled:opacity-100 dark:hover:bg-white/[0.04] dark:focus:bg-white/[0.04] [&>svg]:absolute [&>svg]:right-1 [&>svg]:h-3 [&>svg]:w-3" onValueChange={code => onEntryChange(day.date, person.id, code, entry?.note ?? "")} options={options} displayValue={entry?.code ?? " "} />
    {entry?.code === "OTHER" ? <Input aria-label={t("noteFor", { name: displayName })} className="h-7 w-full rounded-none border-0 border-t bg-transparent px-2 text-xs text-inherit shadow-none focus-visible:ring-0" disabled={readOnly} maxLength={200} value={entry.note} onChange={event => onEntryChange(day.date, person.id, "OTHER", event.target.value)} /> : entry?.note && <p className="max-w-44 truncate px-2 pb-1 text-[10px] text-inherit" title={entry.note}>{entry.note}</p>}
  </td>;
});

type RowProps = Omit<CellProps, "person" | "displayName" | "entry"> & {
  rowNumber: number;
  daily: boolean;
  columns: readonly StaffColumn[];
  current: DraftDay;
  selected: boolean;
  today: boolean;
  canEdit: boolean;
  onSelectDate: (day: string, checked: boolean) => void;
};

const AttendanceRow = memo(function AttendanceRow({ day, rowNumber, daily, columns, current, selected, today, canEdit, readOnly, options, t, onEntryChange, onSelectDate }: RowProps) {
  const entries = useMemo(() => new Map(current.entries.map(entry => [entry.staffId, entry])), [current.entries]);
  return <tr className={cn("group", day.weekday === 6 && "bg-slate-50 dark:bg-slate-900/50", day.weekday === 0 && "bg-orange-50 dark:bg-orange-950/30", selected && "bg-emerald-50 dark:bg-emerald-950/40", today && "bg-emerald-50/60 dark:bg-emerald-950/20")}>
    {!daily && <td aria-hidden="true" className={cn("sticky left-0 z-10 border-b border-r border-[var(--sheet-line)] bg-slate-100 px-2 text-center tabular-nums text-slate-500 dark:bg-slate-800", day.weekday === 0 && "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200")}>{rowNumber}</td>}
    {!daily && <th scope="row" className={cn("sticky left-8 z-10 border-b border-r border-[var(--sheet-line)] bg-background px-2 py-1 text-left font-normal whitespace-nowrap", day.weekday === 0 && "border-l-2 border-l-orange-400 bg-orange-50 font-medium text-orange-800 dark:bg-orange-950 dark:text-orange-200", selected && "bg-emerald-50 dark:bg-emerald-950", today && "font-semibold text-emerald-700 dark:text-emerald-300")}><div className="flex items-center gap-2">{canEdit && <input type="checkbox" className="accent-emerald-600" aria-label={t("selectDate", { date: day.formatted })} disabled={readOnly} checked={selected} onChange={event => onSelectDate(day.date, event.target.checked)} />}<span>{day.formatted}{today && <span className="ml-1 text-[10px]">{t("today")}</span>}</span></div></th>}
    {columns.map(column => <AttendanceCell key={column.person.id} day={day} person={column.person} displayName={column.displayName} entry={entries.get(column.person.id)} readOnly={readOnly} options={options} t={t} onEntryChange={onEntryChange} />)}
  </tr>;
});

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
  const [{ draft, undo }, dispatchDraft] = useReducer(draftReducer, EMPTY_DRAFT_STATE);
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
  const dates = useMemo(() => date ? [date] : monthDates(month), [date, month]);
  const calendar = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", weekday: "short", timeZone: "UTC" });
    return dates.map(day => {
      const value = new Date(`${day}T12:00:00Z`);
      return { date: day, weekday: value.getUTCDay(), formatted: formatter.format(value) };
    });
  }, [dates, locale]);
  const savedDays = useMemo(() => new Map(data.days.map(day => [day.date, { entries: day.entries, expectedUpdatedAt: day.updatedAt }])), [data.days]);
  const selectedDates = useMemo(() => new Set(selected), [selected]);
  const staff = draft?.staff ?? data.config.staff;
  const staffColumns = useMemo(() => staff.map(person => {
    const first = person.name.trim().split(/[\s._]+/)[0] ?? "";
    return { person, displayName: date ? first.charAt(0).toLocaleUpperCase(locale) + first.slice(1) : person.name };
  }), [staff, date, locale]);
  const codeOptions = useMemo(() => ATTENDANCE_CODES.map(code => ({
    value: code,
    label: t(`codes.${code}`),
    marker: <span aria-hidden="true" className={cn("h-3 w-3 shrink-0 rounded-sm ring-1 ring-inset ring-black/10 dark:ring-white/15", attendanceColors[code])} />,
  })), [t]);
  const cellOptions = useMemo(() => [{ value: "", label: t("notEntered") }, ...codeOptions], [codeOptions, t]);
  const roleOptions = [{ value: "SM", label: `SM · ${t("manager")}` }, { value: "SR", label: "SR" }, { value: "IE", label: "IE" }];
  const changeStaff = (next: AttendanceStaff[]) => {
    if (!canEdit || busy || date) return;
    dispatchDraft({ type: "edit", update: previous => ({ revision: previous?.revision ?? data.config.revision, days: previous?.days ?? {}, staff: next }) });
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
  const dayValue = useCallback((day: string): DraftDay => draft?.days[day] ?? savedDays.get(day) ?? EMPTY_DAY, [draft?.days, savedDays]);
  const totals = useMemo(() => attendanceTotals(dates, dayValue), [dates, dayValue]);
  const changeDays = (updates: Record<string, DraftDay>) => {
    dispatchDraft({ type: "edit", update: previous => ({ ...previous, revision: previous?.revision ?? data.config.revision, days: { ...previous?.days, ...updates } }) });
    setError(null);
  };
  const changeEntry = useCallback((day: string, staffId: string, code: string, note = "") => {
    if (!canEdit || busy) return;
    dispatchDraft({ type: "edit", update: previous => {
      const current = previous?.days[day] ?? savedDays.get(day) ?? EMPTY_DAY;
      const entries = current.entries.filter(entry => entry.staffId !== staffId);
      if (code) entries.push({ staffId, code: code as AttendanceEntry["code"], note });
      return { ...previous, revision: previous?.revision ?? data.config.revision, days: { ...previous?.days, [day]: { ...current, entries } } };
    } });
    setError(null);
  }, [canEdit, busy, savedDays, data.config.revision]);
  const selectDate = useCallback((day: string, checked: boolean) => {
    setSelected(previous => checked ? [...previous, day] : previous.filter(value => value !== day));
  }, []);
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
      dispatchDraft({ type: "reset" }); setError(null);
      toast({ title: t("saved") });
    } catch { setError("saveFailed"); }
    finally { setBusy(false); }
  };
  const invalidDraft = staff.some(person => !person.name.trim()) || Object.values(draft?.days ?? {}).some(day => day.entries.some(entry => entry.code === "OTHER" && !entry.note.trim()));
  const editControls = canEdit && <div className="flex flex-wrap items-center gap-1">
    {!date && <Button size="sm" className="h-7 px-2 text-xs" variant="outline" disabled={busy || staff.length >= 50} onClick={() => changeStaff([...staff, { id: crypto.randomUUID(), name: "", role: "SR" }])}><Plus className="mr-1.5 h-4 w-4" />{t("addStaff")}</Button>}
    <Button size="sm" className={date ? "h-7 w-7 p-0" : "h-7 px-2 text-xs"} aria-label={t("undo")} title={t("undo")} variant="ghost" disabled={busy || !undo.length} onClick={() => dispatchDraft({ type: "undo" })}><RotateCcw className={date ? "h-4 w-4" : "mr-1.5 h-4 w-4"} />{!date && t("undo")}</Button>
    <Button size="sm" className={date ? "h-7 w-7 p-0" : "h-7 px-2 text-xs"} aria-label={t("cancel")} title={t("cancel")} variant="outline" disabled={busy || !draft} onClick={() => { dispatchDraft({ type: "reset" }); setError(null); void queryClient.invalidateQueries({ queryKey: attendanceQueryKey(shopId, month) }); }}>{date ? <X className="h-4 w-4" /> : t("cancel")}</Button>
    <Button size="sm" className={date ? "h-7 w-7 p-0" : "h-7 px-2 text-xs"} aria-label={t("save")} title={t("save")} disabled={busy || !draft || invalidDraft} onClick={() => void save()}>{busy ? <LoaderCircle className={cn("h-4 w-4 animate-spin", !date && "mr-1.5")} /> : <Save className={cn("h-4 w-4", !date && "mr-1.5")} />}{!date && t("save")}</Button>
  </div>;
  return <div className="space-y-2">
    {canEdit && <div className={date ? "absolute right-12 top-2" : "flex flex-wrap items-center justify-end gap-1"}>{editControls}</div>}
    {!date && canEdit && <div className="flex flex-wrap items-center gap-2 rounded-sm border bg-muted/20 p-2">
      <span className="text-xs text-muted-foreground">{t("selectedDates", { count: selected.length })}</span>
      <AppSelect aria-label={t("applyTo")} value={bulkStaffId} disabled={busy} onValueChange={setBulkStaffId} className="w-full sm:w-52" options={[{ value: "", label: t("allStaff") }, ...staff.map(person => ({ value: person.id, label: person.name }))]} />
      <AppSelect aria-label={t("bulkCode")} value={bulkCode} disabled={busy} onValueChange={value => setBulkCode(value as AttendanceEntry["code"])} className={cn("w-full sm:w-52", attendanceColors[bulkCode])} options={codeOptions} />
      <Input value={bulkNote} onChange={event => setBulkNote(event.target.value)} maxLength={200} disabled={busy} placeholder={t("notePlaceholder")} aria-label={t("note")} className="h-9 max-w-56" />
      <Button size="sm" className="h-7 px-2 text-xs" variant="outline" disabled={busy || !selected.length || bulkCode === "OTHER" && !bulkNote.trim()} onClick={() => {
        const affected = staff.filter(person => !bulkStaffId || person.id === bulkStaffId);
        const affectedIds = new Set(affected.map(person => person.id));
        const updates = Object.fromEntries(selected.map(day => {
          const current = dayValue(day);
          return [day, { ...current, entries: [...current.entries.filter(entry => !affectedIds.has(entry.staffId)), ...affected.map(person => ({ staffId: person.id, code: bulkCode, note: bulkNote.trim() }))] }];
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
            const current = dayValue(day);
            updates[day] = { ...current, entries: [...current.entries.filter(entry => bulkStaffId && entry.staffId !== bulkStaffId), ...copied] };
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
      <table aria-label={date ? t("staffToday") : t("monthlyRoster")} style={{ width: date ? "100%" : 176 + staff.length * 144, minWidth: date ? staff.length * 64 : undefined }} className="table-fixed border-separate border-spacing-0 bg-background text-xs">
        <colgroup>{!date && <><col className="w-8" /><col className="w-36" /></>}{staff.map(person => <col key={person.id} />)}</colgroup>
        <thead className="sticky top-0 z-20">
          {!date && <tr className="h-5 bg-slate-100 text-[11px] font-normal text-slate-500 dark:bg-slate-800 dark:text-slate-300">
            <th aria-hidden="true" className="sticky left-0 z-30 border-b border-r border-[var(--sheet-line)] bg-slate-100 dark:bg-slate-800" />
            <th scope="col" className="sticky left-8 z-30 border-b border-r border-[var(--sheet-line)] bg-slate-100 font-normal dark:bg-slate-800">A</th>
            {staff.map((person, index) => <th key={person.id} scope="col" className="border-b border-r border-[var(--sheet-line)] font-normal">
              <div className="flex items-center justify-between px-1">
                {!date && canEdit && <Button type="button" size="icon" variant="ghost" className="h-6 w-6 rounded-none" aria-label={t("moveColumnLeft", { name: person.name || t("staffName") })} title={t("moveColumnLeft", { name: person.name || t("staffName") })} disabled={busy || index === 0} onClick={() => moveStaff(index, -1)}><ArrowLeft className="h-3 w-3" /></Button>}
                <span className="flex-1">{columnLetter(index + 1)}</span>
                {!date && canEdit && <Button type="button" size="icon" variant="ghost" className="h-6 w-6 rounded-none" aria-label={t("moveColumnRight", { name: person.name || t("staffName") })} title={t("moveColumnRight", { name: person.name || t("staffName") })} disabled={busy || index === staff.length - 1} onClick={() => moveStaff(index, 1)}><ArrowRight className="h-3 w-3" /></Button>}
              </div>
            </th>)}
          </tr>}
          <tr className="bg-slate-50 dark:bg-slate-900">
            {!date && <th aria-hidden="true" className="sticky left-0 z-30 border-b border-r border-[var(--sheet-line)] bg-slate-100 font-normal text-slate-500 dark:bg-slate-800">1</th>}
            {!date && <th scope="col" className="sticky left-8 z-30 border-b border-r border-[var(--sheet-line)] bg-slate-50 px-3 text-left font-semibold dark:bg-slate-900">{t("date")}</th>}
            {staff.map((person, index) => <th key={person.id} scope="col" className={cn("border-b border-r border-[var(--sheet-line)] p-0 text-center", !date && person.role === "SM" && "bg-emerald-50 dark:bg-emerald-950")}>
              {!date && canEdit ? <>
                <input aria-label={t("staffNameColumn", { column: columnLetter(index + 1) })} title={person.name || t("staffName")} placeholder={t("staffName")} value={person.name} maxLength={120} disabled={busy} className="h-7 w-full min-w-0 border-0 bg-transparent px-2 text-center font-semibold outline-none focus:bg-background focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-emerald-600 disabled:opacity-70" onChange={event => changeStaff(staff.map(item => item.id === person.id ? { ...item, name: event.target.value } : item))} />
                <AppSelect aria-label={t("staffRoleColumn", { column: columnLetter(index + 1) })} title={person.role === "SM" ? t("manager") : person.role} value={person.role} disabled={busy} className="relative h-6 justify-center rounded-none border-0 border-t border-[var(--sheet-line)] bg-transparent px-4 py-0 text-center text-[11px] font-normal shadow-none focus:ring-inset focus:ring-emerald-600 focus:ring-offset-0 [&>svg]:absolute [&>svg]:right-1 [&>svg]:h-3 [&>svg]:w-3" onValueChange={value => changeStaff(staff.map(item => item.id === person.id ? { ...item, role: value as AttendanceStaff["role"] } : item))} options={roleOptions} />
              </> : date ? <div className="truncate px-2 py-1 font-medium">{staffColumns[index].displayName}</div> : <div className="px-1.5 py-1"><div className="flex items-center justify-center gap-1 font-semibold">{person.role === "SM" && <BriefcaseBusiness className="h-3.5 w-3.5 shrink-0" />}<span className="max-w-32 truncate" title={person.name}>{person.name}</span></div><span className="text-[11px] font-normal text-muted-foreground">{person.role === "SM" ? `SM · ${t("manager")}` : person.role}</span></div>}
            </th>)}
          </tr>
        </thead>
        <tbody>{calendar.map((day, index) => <AttendanceRow key={day.date} day={day} rowNumber={index + 2} daily={Boolean(date)} columns={staffColumns} current={dayValue(day.date)} selected={selectedDates.has(day.date)} today={day.date === today} canEdit={canEdit} readOnly={!canEdit || busy} options={cellOptions} t={t} onEntryChange={changeEntry} onSelectDate={selectDate} />)}</tbody>
        {!date && <tfoot className="sticky bottom-0 z-[15]"><tr className="bg-slate-100 dark:bg-slate-800"><td aria-hidden="true" className="sticky left-0 z-20 border-r border-[var(--sheet-line)] bg-slate-100 px-2 text-center text-slate-500 dark:bg-slate-800">{dates.length + 2}</td><th scope="row" className="sticky left-8 z-20 border-r border-[var(--sheet-line)] bg-slate-100 px-2 py-1 text-left text-xs dark:bg-slate-800">{t("totals")}</th>{staff.map(person => {
          const counts = totals.get(person.id);
          return <td key={person.id} className="border-r border-[var(--sheet-line)] px-2 py-1 text-center text-[10px] tabular-nums">{TOTAL_CODES.map(code => `${code}: ${counts?.[code] ?? 0}`).join(" · ")}</td>;
        })}</tr></tfoot>}
      </table>
    </div>
    </div>
    {!staff.length && <p className="text-sm text-muted-foreground">{t("noStaff")}</p>}
    {!date && canEdit && <p className="text-xs text-muted-foreground">{t("editGridHint")}</p>}
    {!date && <p className="text-xs text-muted-foreground">{t("gridHint")}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{t(`errors.${error}`)}</p>}
  </div>;
}
