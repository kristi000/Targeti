import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "use-intl";

import { SegmentedControl } from "@/components/manager/manager-ui";
import { useShop } from "@/components/shop-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { handleSaveAttendance } from "@/server/actions/attendance";
import { handleDeleteProcedures, handleSaveProcedures } from "@/server/actions/procedures";
import { ATTENDANCE_CODES, attendanceQueryKey, type AttendanceEntry, type AttendanceMonth, type AttendanceStaff } from "@/lib/attendance";
import { dailyActivityMonthQueryKey } from "@/lib/daily-activity";
import { todayInTirana } from "@/lib/manager-mode";
import { PROCEDURE_PRODUCTS, PROCEDURE_STATUSES, proceduresQueryKey, type ProcedureFields, type ProcedureRecord } from "@/lib/procedures";
import { getMonthlyRepresentatives } from "@/lib/types";
import { cn } from "@/lib/utils";

/* Phone editors for attendance and procedures. Each save goes through the same server actions as the full pages. */

type AttendanceCode = AttendanceEntry["code"];

/** Saves one day's full entry list for the month, guarded by the month revision and the day's last update. */
export function useSaveAttendanceDay(shopId: string, month: string) {
  const client = useQueryClient();
  return async (data: AttendanceMonth, date: string, entries: AttendanceEntry[]) => {
    const day = data.days.find(item => item.date === date);
    const result = await handleSaveAttendance({
      shopId, month, expectedRevision: data.config.revision,
      changes: [{ date, entries, expectedUpdatedAt: day?.updatedAt ?? null }],
    });
    if (result.success) client.setQueryData(attendanceQueryKey(shopId, month), result.data);
    else void client.invalidateQueries({ queryKey: attendanceQueryKey(shopId, month) });
    return result;
  };
}

export function AttendanceEntrySheet({ shopId, month, date, dateLabel, person, data, onClose }: {
  shopId: string; month: string; date: string; dateLabel: string; person: AttendanceStaff | null; data: AttendanceMonth; onClose: () => void;
}) {
  return (
    <Sheet open={person !== null} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="bottom" className="manager-ui bg-background max-h-[85svh] overflow-y-auto rounded-t-3xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5">
        {person && <AttendanceEntryForm key={`${person.id}:${date}`} shopId={shopId} month={month} date={date} dateLabel={dateLabel} person={person} data={data} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function AttendanceEntryForm({ shopId, month, date, dateLabel, person, data, onClose }: {
  shopId: string; month: string; date: string; dateLabel: string; person: AttendanceStaff; data: AttendanceMonth; onClose: () => void;
}) {
  const t = useTranslations("Manager");
  const attendance = useTranslations("Attendance");
  const { toast } = useToast();
  const save = useSaveAttendanceDay(shopId, month);
  const dayEntries = data.days.find(day => day.date === date)?.entries ?? [];
  const current = dayEntries.find(entry => entry.staffId === person.id);
  const [code, setCode] = useState<AttendanceCode | null>(current?.code ?? null);
  const [note, setNote] = useState(current?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteMissing = code === "OTHER" && !note.trim();

  const submit = async (nextCode: AttendanceCode | null) => {
    if (busy || (nextCode === "OTHER" && !note.trim())) return;
    setBusy(true);
    setError(null);
    // Edited entries drop the Excel template's original text; untouched entries keep theirs.
    const others = dayEntries.filter(entry => entry.staffId !== person.id);
    const entries = nextCode ? [...others, { staffId: person.id, code: nextCode, note: note.trim() }] : others;
    try {
      const result = await save(data, date, entries);
      if (!result.success) { setError(result.error); return; }
      toast({ title: attendance("saved") });
      onClose();
    } catch {
      setError("saveFailed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SheetHeader className="text-left">
        <SheetTitle>{person.name}</SheetTitle>
        <SheetDescription>{dateLabel}</SheetDescription>
      </SheetHeader>
      <div className="mt-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label={attendance("chooseFor", { name: person.name, date })}>
        {ATTENDANCE_CODES.map(value => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={code === value}
            disabled={busy}
            onClick={() => setCode(value)}
            className={cn("rounded-xl border px-3 py-2.5 text-left text-sm", code === value ? "border-primary bg-primary/10 font-medium text-primary" : "border-border", value === "OTHER" && "col-span-2")}
          >
            {attendance(`codes.${value}`)}
          </button>
        ))}
      </div>
      <label className="mt-3 block space-y-1 text-xs">
        <span className="font-medium">{attendance("note")}</span>
        <Input value={note} maxLength={200} disabled={busy} placeholder={attendance("notePlaceholder")} onChange={event => setNote(event.target.value)} className="h-10" aria-invalid={noteMissing} />
      </label>
      {noteMissing && <p className="mt-1 text-xs text-destructive">{t("entry.noteRequired")}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{t(`entry.errors.${error === "conflict" || error === "staffInUse" ? error : "saveFailed"}`)}</p>}
      <div className="mt-4 flex gap-2">
        {current && (
          <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={() => void submit(null)}>{t("entry.clear")}</Button>
        )}
        <Button type="button" className="flex-1" disabled={busy || !code || noteMissing} onClick={() => void submit(code)}>
          {busy && <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" />}{t("entry.save")}
        </Button>
      </div>
    </>
  );
}

/** Copies the previous day's entries onto an empty day. */
export function previousDayEntries(data: AttendanceMonth, date: string): AttendanceEntry[] | null {
  const previous = [...data.days].filter(day => day.date < date && day.entries.length).sort((left, right) => right.date.localeCompare(left.date))[0];
  if (!previous) return null;
  const staffIds = new Set(data.config.staff.map(person => person.id));
  return previous.entries.filter(entry => staffIds.has(entry.staffId)).map(entry => ({ staffId: entry.staffId, code: entry.code, note: entry.note }));
}

type ProcedureSheetState = { mode: "add" } | { mode: "edit"; record: ProcedureRecord } | null;

function nowTime() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Tirane", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date());
}

export function ProcedureSheet({ shopId, month, state, onClose }: { shopId: string; month: string; state: ProcedureSheetState; onClose: () => void }) {
  const t = useTranslations("Procedures");
  return (
    <Sheet open={state !== null} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="bottom" className="manager-ui bg-background max-h-[90svh] overflow-y-auto rounded-t-3xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5">
        {state && (
          <>
            <SheetHeader className="text-left">
              <SheetTitle>{state.mode === "add" ? t("add") : state.record.name}</SheetTitle>
              <SheetDescription>{state.mode === "add" ? t("entryHint", { date: month }) : `${state.record.product} · ${state.record.user}`}</SheetDescription>
            </SheetHeader>
            <ProcedureForm key={state.mode === "add" ? "add" : state.record.id} shopId={shopId} month={month} record={state.mode === "edit" ? state.record : null} onDone={onClose} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ProcedureForm({ shopId, month, record, onDone }: { shopId: string; month: string; record: ProcedureRecord | null; onDone: () => void }) {
  const t = useTranslations("Procedures");
  const manager = useTranslations("Manager");
  const { shops } = useShop();
  const client = useQueryClient();
  const { toast } = useToast();
  const shop = shops.find(item => item.id === shopId);
  const representatives = shop ? getMonthlyRepresentatives(shop, month) : [];
  const today = todayInTirana();
  const [orderNumber, setOrderNumber] = useState(record?.orderNumber ?? "");
  const [name, setName] = useState(record?.name ?? "");
  const [customerId, setCustomerId] = useState(record?.customerId ?? "");
  const [product, setProduct] = useState<ProcedureFields["product"] | "">(record?.product ?? "");
  const [status, setStatus] = useState<ProcedureFields["status"]>(record?.status ?? "pending");
  const [representativeId, setRepresentativeId] = useState(() => record ? representatives.find(item => item.name === record.user)?.id ?? "" : "");
  const [date, setDate] = useState(record?.dateTime.slice(0, 10) ?? (today.startsWith(month) ? today : `${month}-01`));
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const representative = representatives.find(item => item.id === representativeId);
  const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const valid = orderNumber.trim() && name.trim() && customerId.trim() && product && date.startsWith(`${month}-`) && (record || representative);

  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: proceduresQueryKey(shopId, month) }),
    client.invalidateQueries({ queryKey: dailyActivityMonthQueryKey(shopId, month) }),
  ]);
  const save = async () => {
    if (!valid || busy || !product) return;
    setBusy(true);
    setError(null);
    try {
      const time = record ? record.dateTime.slice(11) : nowTime();
      const fields: ProcedureFields = {
        orderNumber: orderNumber.trim(), name: name.trim(), customerId: customerId.trim(), product, status,
        user: representative?.name ?? record?.user ?? "", dateTime: `${date}T${time}`,
      };
      const representativeChanged = !record || (representative && representative.name !== record.user);
      const result = await handleSaveProcedures({
        shopId, month,
        changes: [{
          id: record?.id ?? `1-${Date.now()}-${crypto.randomUUID()}`,
          expectedRevision: record?.revision ?? 0,
          fields,
          ...(representativeChanged && representative ? { representativeId: representative.id } : {}),
        }],
      });
      if (!result.success) { setError(result.error); return; }
      await refresh();
      toast({ title: t("saved") });
      onDone();
    } catch {
      setError("saveFailed");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!record || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await handleDeleteProcedures({ shopId, month, records: [{ id: record.id, expectedRevision: record.revision }] });
      if (!result.success) { setError(result.error === "conflict" ? "conflict" : "deleteFailed"); return; }
      await refresh();
      toast({ title: manager("entry.deleted") });
      onDone();
    } catch {
      setError("deleteFailed");
    } finally {
      setBusy(false);
    }
  };

  const text = (key: "orderNumber" | "name" | "customerId", value: string, set: (value: string) => void) => (
    <label className="block space-y-1 text-xs">
      <span className="font-medium">{t(key)}</span>
      <Input required maxLength={150} value={value} disabled={busy} onChange={event => set(event.target.value)} className="h-10" />
    </label>
  );

  return (
    <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}>
      {record && (
        <div className="space-y-1 text-xs">
          <span className="font-medium">{t("status")}</span>
          <SegmentedControl label={t("status")} value={status} onChange={setStatus} options={PROCEDURE_STATUSES.map(value => ({ value, label: t(value) }))} />
        </div>
      )}
      {text("name", name, setName)}
      <div className="grid grid-cols-2 gap-2">
        {text("orderNumber", orderNumber, setOrderNumber)}
        {text("customerId", customerId, setCustomerId)}
      </div>
      <div className="space-y-1 text-xs">
        <span className="font-medium">{t("product")}</span>
        <SegmentedControl label={t("product")} value={product || "none"} onChange={value => setProduct(value === "none" ? "" : value as ProcedureFields["product"])} options={PROCEDURE_PRODUCTS.map(value => ({ value, label: value }))} />
      </div>
      <label className="block space-y-1 text-xs">
        <span className="font-medium">{t("user")}</span>
        <select required={!record} value={representativeId} disabled={busy || !representatives.length} onChange={event => setRepresentativeId(event.target.value)} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
          {/* When editing, the blank choice keeps the saved user; it is only needed if they left the roster. */}
          {(!record || !representatives.some(item => item.name === record.user)) && <option value="">{record ? record.user : t("selectRepresentative")}</option>}
          {representatives.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-xs">
        <span className="font-medium">{t("entryDate")}</span>
        <Input type="date" required value={date} min={`${month}-01`} max={`${month}-${String(lastDay).padStart(2, "0")}`} disabled={busy} onChange={event => setDate(event.target.value)} className="h-10" />
      </label>
      {!representatives.length && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{t("noRepresentatives")}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{t(`errors.${["conflict", "invalidData", "representativeRequired", "deleteFailed", "UNAUTHENTICATED", "EDITOR_REQUIRED", "SHOP_ACCESS_REQUIRED"].includes(error) ? error : "saveFailed"}`)}</p>}
      <Button type="submit" className="w-full" disabled={busy || !valid}>
        {busy && <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" />}{record ? t("save") : t("add")}
      </Button>
      {record && (confirmDelete
        ? <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={() => setConfirmDelete(false)}>{t("cancel")}</Button>
          <Button type="button" variant="destructive" className="flex-1" disabled={busy} onClick={() => void remove()}>{t("confirmDelete")}</Button>
        </div>
        : <Button type="button" variant="ghost" className="w-full text-destructive" disabled={busy} onClick={() => setConfirmDelete(true)}>
          <Trash2 aria-hidden="true" className="mr-1.5 h-4 w-4" />{t("delete")}
        </Button>)}
    </form>
  );
}

export type { ProcedureSheetState };
