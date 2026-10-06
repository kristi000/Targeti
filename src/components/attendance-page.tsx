"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Download, FileSpreadsheet, LoaderCircle, Plus, Users } from "lucide-react";
import { fetchAttendanceMonth, handleSaveAttendance } from "@/app/actions/attendance";
import { attendanceQueryKey, monthDates, type AttendanceConfig, type AttendanceStaff } from "@/lib/attendance";
import type { WorkbookSheet } from "@/lib/attendance-workbook";
import { useShop } from "@/components/shop-provider";
import { AttendanceEditor } from "@/components/attendance-editor";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

export function AttendancePage({ shopId, initialMonth }: { shopId: string; initialMonth: string }) {
  const t = useTranslations("Attendance");
  const locale = useLocale();
  const router = useRouter();
  const { shops, actor, setSelectedShop, setSelectedDatasetId } = useShop();
  const shop = shops.find(item => item.id === shopId);
  const [month, setMonth] = useState(initialMonth);
  const [dialog, setDialog] = useState<"staff" | "template" | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const query = useQuery({ queryKey: attendanceQueryKey(shopId, month), queryFn: () => fetchAttendanceMonth(shopId, month) });
  useEffect(() => { if (shop) setSelectedShop(shop); setSelectedDatasetId(month); }, [shop, month, setSelectedShop, setSelectedDatasetId]);
  const download = async () => {
    setExporting(true); setError(null);
    try {
      const response = await fetch(`/api/shops/${encodeURIComponent(shopId)}/attendance-template?month=${month}`);
      if (!response.ok) { const result = await response.json(); setError(result.error ?? "requestFailed"); return; }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = `${shop?.name ?? "shop"}-attendance-${month}.xlsx`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError("requestFailed"); }
    finally { setExporting(false); }
  };
  return <>
    <Header title={`${shop?.name ?? ""} · ${t("title")}`} />
    <main className="space-y-4 p-3 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-medium">{t("month")}<Input type="month" value={month} min="2000-01" max="2099-12" disabled={dirty || exporting || dialog !== null} className="w-44" onChange={event => {
          if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(event.target.value)) return;
          setMonth(event.target.value); setError(null); router.replace(`/${locale}/shop/${shopId}/attendance?month=${event.target.value}`, { scroll: false });
        }} /></label>
        <div className="flex flex-wrap gap-2">
          {actor.role !== "viewer" && <><Button variant="outline" size="sm" disabled={dirty || !query.data} onClick={() => setDialog("staff")}><Users className="mr-1.5 h-4 w-4" />{t("manageStaff")}</Button><Button variant="outline" size="sm" disabled={dirty || !query.data} onClick={() => setDialog("template")}><FileSpreadsheet className="mr-1.5 h-4 w-4" />{t("importTemplate")}</Button></>}
          <Button size="sm" disabled={dirty || exporting || !query.data?.config.template} onClick={() => void download()}>{exporting ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}{t("exportOriginal")}</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{query.data?.config.template ? t("templateAttached", { name: query.data.config.template.fileName }) : t("templateHint")}</p>
      {error && <p role="alert" className="text-sm text-destructive">{t(`errors.${error}`)}</p>}
      <AttendanceEditor key={`${shopId}:${month}`} shopId={shopId} month={month} canEdit={actor.role !== "viewer"} onDirtyChange={setDirty} />
      {dialog === "staff" && query.data && <StaffDialog shopId={shopId} month={month} config={query.data.config} onClose={() => setDialog(null)} />}
      {dialog === "template" && query.data && <TemplateDialog shopId={shopId} month={month} onClose={() => setDialog(null)} />}
    </main>
  </>;
}
function StaffDialog({ shopId, month, config, onClose }: { shopId: string; month: string; config: AttendanceConfig; onClose: () => void }) {
  const t = useTranslations("Attendance");
  const queryClient = useQueryClient();
  const [staff, setStaff] = useState<AttendanceStaff[]>(config.staff);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    try {
      const result = await handleSaveAttendance({ shopId, month, expectedRevision: config.revision, staff, changes: [] });
      if (!result.success) { setError(result.error); return; }
      queryClient.setQueryData(attendanceQueryKey(shopId, month), result.data); onClose();
    } catch { setError("saveFailed"); } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>{t("manageStaff")}</DialogTitle><DialogDescription>{t("staffHint")}</DialogDescription></DialogHeader>
    {staff.map((person, index) => <div key={person.id} className="flex gap-2"><Input aria-label={t("staffName")} value={person.name} disabled={busy} maxLength={120} onChange={event => setStaff(previous => previous.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} /><select aria-label={t("staffRole")} className="rounded border bg-background px-2" disabled={busy} value={person.role} onChange={event => setStaff(previous => previous.map((item, i) => i === index ? { ...item, role: event.target.value as AttendanceStaff["role"] } : item))}><option value="SM">{t("manager")} (SM)</option><option value="SR">SR</option><option value="IE">IE</option></select></div>)}
    <Button size="sm" variant="outline" disabled={busy || staff.length >= 50} onClick={() => setStaff(previous => [...previous, { id: crypto.randomUUID(), name: "", role: "SR" }])}><Plus className="mr-1.5 h-4 w-4" />{t("addStaff")}</Button>
    {error && <p role="alert" className="text-sm text-destructive">{t(`errors.${error}`)}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{t("cancel")}</Button><Button disabled={busy || !staff.length || staff.some(person => !person.name.trim())} onClick={() => void save()}>{busy && <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" />}{t("save")}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
function TemplateDialog({ shopId, month, onClose }: { shopId: string; month: string; onClose: () => void }) {
  const t = useTranslations("Attendance");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: attendanceQueryKey(shopId, month), queryFn: () => fetchAttendanceMonth(shopId, month) });
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<WorkbookSheet[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [baseline, setBaseline] = useState<typeof query.data>(undefined);
  const sheet = sheets.find(item => item.name === sheetName);
  const chooseSheet = (name: string, allSheets = sheets) => {
    setSheetName(name); setReviewed(false);
    const selected = allSheets.find(item => item.name === name);
    setMapping(Object.fromEntries(selected?.staff.map(person => [person.column, query.data?.config.staff.find(item => item.name.trim().toLocaleLowerCase() === person.name.trim().toLocaleLowerCase())?.id ?? `new-${person.column}`]) ?? []));
  };
  const preview = async (selectedFile: File) => {
    setBusy(true); setError(null); setSheets([]); setSheetName(""); setReviewed(false); setFile(selectedFile);
    try {
      const form = new FormData(); form.set("file", selectedFile); form.set("mode", "preview");
      const response = await fetch(`/api/shops/${encodeURIComponent(shopId)}/attendance-template`, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) { setError(result.error ?? "requestFailed"); return; }
      setSheets(result.sheets); setBaseline(query.data);
      const selected = (result.sheets as WorkbookSheet[]).find(item => item.month === month) ?? (result.sheets as WorkbookSheet[]).at(-1);
      if (selected) chooseSheet(selected.name, result.sheets);
      else setError("monthNotFound");
    } catch { setError("requestFailed"); } finally { setBusy(false); }
  };
  const upload = async () => {
    if (!file || !sheet || !baseline) return;
    setBusy(true); setError(null);
    try {
      const staff = sheet.staff.map(person => {
        const existing = baseline.config.staff.find(item => item.id === mapping[person.column]);
        return { id: existing?.id ?? crypto.randomUUID(), name: existing?.name ?? person.name, role: person.role };
      });
      const form = new FormData(); form.set("file", file); form.set("mode", "import");
      form.set("input", JSON.stringify({ month, sheet: sheet.name, expectedRevision: baseline.config.revision, staff,
        mapping: sheet.staff.map((person, index) => ({ column: person.column, staffId: staff[index].id })),
        expectedDays: Object.fromEntries(baseline.days.map(day => [day.date, day.updatedAt])),
      }));
      const response = await fetch(`/api/shops/${encodeURIComponent(shopId)}/attendance-template`, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) { setError(result.error ?? "requestFailed"); return; }
      queryClient.setQueryData(attendanceQueryKey(shopId, month), result.data); toast({ title: t("imported") }); onClose();
    } catch { setError("requestFailed"); } finally { setBusy(false); }
  };
  const unusual = sheet?.days.flatMap(day => day.values.filter(value => value.trim() && !/^(1|2|P|LV|R)$/i.test(value.trim()))) ?? [];
  const previewDays = sheet?.month === month ? sheet.days : monthDates(month).map(date => ({ date, values: sheet?.staff.map(() => "") ?? [] }));
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>{t("importTemplate")}</DialogTitle><DialogDescription>{t("importHint")}</DialogDescription></DialogHeader>
    <Input type="file" accept=".xlsx" disabled={busy} aria-label={t("chooseFile")} onChange={event => { const selected = event.target.files?.[0]; if (selected) void preview(selected); }} />
    {busy && <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle className="h-4 w-4 animate-spin" />{t("loading")}</p>}
    {sheets.length > 0 && <label className="space-y-1 text-sm"><span>{t("sheet")}</span><select className="block h-9 w-full rounded border bg-background px-2" disabled={busy} value={sheetName} onChange={event => chooseSheet(event.target.value)}><option value="">{t("chooseSheet")}</option>{sheets.map(item => <option key={item.name}>{item.name}</option>)}</select></label>}
    {sheet && <>
      <p className="text-sm font-medium">{sheet.shopName} · {month} · {t("dayCount", { count: previewDays.length })}</p>
      {sheet.month !== month && <p className="text-sm text-primary">{t("reuseTemplate", { month })}</p>}
      {sheet.staff.map(person => <div key={person.column} className="grid grid-cols-2 items-center gap-3 text-sm"><span>{person.name} <span className="text-muted-foreground">({person.role})</span></span><select aria-label={t("mapStaff", { name: person.name })} disabled={busy} value={mapping[person.column]} className="h-9 rounded border bg-background px-2" onChange={event => { setMapping(previous => ({ ...previous, [person.column]: event.target.value })); setReviewed(false); }}><option value={`new-${person.column}`}>{t("newStaff")}</option>{baseline?.config.staff.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>)}
      <div className="overflow-auto rounded border"><table className="w-full text-xs"><thead><tr><th className="p-2 text-left">{t("date")}</th>{sheet.staff.map(person => <th key={person.column} className="p-2">{person.name}</th>)}</tr></thead><tbody>{previewDays.slice(0, 5).map(day => <tr key={day.date} className="border-t"><td className="p-2">{day.date}</td>{day.values.map((value, index) => <td key={index} className="p-2 text-center">{value || "—"}</td>)}</tr>)}</tbody></table></div>
      {sheet.month === month && unusual.length > 0 && <p className="text-xs text-muted-foreground">{t("unusualEntries", { values: [...new Set(unusual)].join(", ") })}</p>}
      {baseline?.days.length ? <p className="text-sm text-amber-700 dark:text-amber-300">{t("replaceWarning")}</p> : null}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} />{t(sheet.month === month ? "reviewMapping" : "reviewTemplate")}</label>
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{t(`errors.${error}`)}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{t("cancel")}</Button><Button disabled={busy || !sheet || !reviewed || new Set(Object.values(mapping)).size !== sheet?.staff.length} onClick={() => void upload()}>{t(sheet?.month === month ? "importSelected" : "useTemplate")}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
