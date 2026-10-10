"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, FileSpreadsheet, LoaderCircle, RefreshCw, Save, Trash2, Undo2, X } from "lucide-react";
import { fetchProcedures, handleSaveProcedures, handleDeleteProcedures, handleRestoreProcedures } from "@/app/actions/procedures";
import { DeletedProceduresDialog } from "@/components/deleted-procedures-dialog";
import { ProcedureStatus } from "@/components/procedure-status";
import { ProcedureEntry } from "@/components/procedure-entry";
import { procedureFieldsSchema, procedureSummarySchema } from "@/lib/persistence-schemas";
import { dailyActivityMonthQueryKey } from "@/lib/daily-activity";
import { resolveProcedureUserName } from "@/lib/procedure-users";
import { getMonthlyRepresentatives, type SalesRepresentative } from "@/lib/types";
import { PROCEDURE_PRODUCTS, proceduresQueryKey, procedurePageQueryKey, type ProcedureFields, type ProcedureFilter, type ProcedureRecord, type ProcedureSort, type ProcedureSummary, type ProceduresPage } from "@/lib/procedures";
import { useShop } from "@/components/shop-provider";
import { Header } from "@/components/header";
import { ShopPageToolbar } from "@/components/shop-page-toolbar";
import { Button } from "@/components/ui/button";
import { AppSelect } from "@/components/ui/app-select";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const fieldsOf = (record: ProcedureRecord): ProcedureFields => ({ orderNumber: record.orderNumber, name: record.name, customerId: record.customerId, product: record.product, dateTime: record.dateTime, user: record.user, status: record.status });
type ProcedureDraft = { fields: ProcedureFields; originalFields: ProcedureFields; expectedRevision: number };
const COLUMNS: Array<{ key: keyof ProcedureFields; width: number }> = [{ key: "orderNumber", width: 185 }, { key: "name", width: 140 }, { key: "customerId", width: 95 }, { key: "product", width: 70 }, { key: "dateTime", width: 104 }, { key: "user", width: 140 }, { key: "status", width: 52 }];
const emptyProcedureRows: ProcedureRecord[] = [];

function ProcedureCell({ field, record, fields, rowNumber, representatives, canEdit, disabled, onChange }: {
  field: keyof ProcedureFields; record: ProcedureRecord; fields: ProcedureFields; rowNumber: number;
  representatives: readonly SalesRepresentative[];
  canEdit: boolean; disabled: boolean; onChange: (field: keyof ProcedureFields, value: string) => void;
}) {
  const t = useTranslations("Procedures");
  const value = field === "user" ? resolveProcedureUserName(fields.user, representatives) : fields[field];
  const label = `${t(field)} · ${rowNumber}`;
  if (field === "status") return <ProcedureStatus status={fields.status} label={label} disabled={disabled} onChange={canEdit ? next => onChange(field, next) : undefined} />;
  if (!canEdit) return <span title={field === "user" ? value : undefined} className="block px-2 py-1">{field === "dateTime" ? value.slice(0, 10) : value}</span>;
  if (field === "user") return <AppSelect aria-label={label} title={value} disabled={disabled} required className="h-8 min-w-0 rounded-none border-0 bg-transparent px-2 text-xs shadow-none focus:ring-inset focus:ring-primary [&>svg]:hidden" contentClassName="min-w-48" value={value} onValueChange={next => onChange(field, next)} options={[...new Set([...representatives.map(item => item.name), resolveProcedureUserName(record.user, representatives), value])].map(user => ({ value: user, label: user }))} />;
  if (field === "product") return <AppSelect aria-label={label} disabled={disabled} value={value} onValueChange={next => onChange(field, next)} className="h-8 rounded-none border-0 bg-transparent px-1 text-xs shadow-none focus:ring-inset focus:ring-primary [&>svg]:hidden" contentClassName="min-w-32" options={PROCEDURE_PRODUCTS.map(option => ({ value: option, label: option }))} />;
  return <input aria-label={label} disabled={disabled} required maxLength={150} type={field === "dateTime" ? "date" : "text"} className="h-8 w-full min-w-0 bg-transparent px-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-calendar-picker-indicator]:hidden" value={field === "dateTime" ? value.slice(0, 10) : value} onChange={event => onChange(field, field === "dateTime" ? `${event.target.value}${record.dateTime.slice(10)}` : event.target.value)} />;
}

export function ProceduresPage({ shopId, initialMonth, initialDate }: { shopId: string; initialMonth: string; initialDate: string }) {
  const t = useTranslations("Procedures");
  const locale = useLocale();
  const router = useRouter();
  const { shops, actor, setSelectedShop, setSelectedDatasetId } = useShop();
  const shop = shops.find(item => item.id === shopId);
  const [month, setMonth] = useState(initialMonth);
  const [entryDate, setEntryDate] = useState(initialDate);
  const [entryDirty, setEntryDirty] = useState(false);
  const [sort, setSort] = useState<ProcedureSort>("source");
  const [cursor, setCursor] = useState<string | undefined>();
  const [previousCursors, setPreviousCursors] = useState<Array<string | undefined>>([]);
  const [drafts, setDrafts] = useState<Record<string, ProcedureDraft>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [filter, setFilter] = useState<ProcedureFilter>({});
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [deleteTargets, setDeleteTargets] = useState<Array<{ id: string; expectedRevision: number }>>([]);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [lastDeletion, setLastDeletion] = useState<{ month: string; records: Array<{ id: string; expectedRevision: number }> } | null>(null);
  const client = useQueryClient();
  const refreshMonth = () => Promise.all([
    client.invalidateQueries({ queryKey: proceduresQueryKey(shopId, month) }),
    client.invalidateQueries({ queryKey: dailyActivityMonthQueryKey(shopId, month) }),
  ]);
  const query = useQuery({
    queryKey: procedurePageQueryKey(shopId, month, filter, cursor, sort),
    queryFn: () => fetchProcedures(shopId, month, cursor, filter, sort),
    placeholderData: (previousData, previousQuery) => previousQuery?.queryKey[0] === "procedures" && previousQuery.queryKey[1] === shopId && previousQuery.queryKey[2] === month ? previousData : undefined,
  });
  const cachedPage = client.getQueryData<ProceduresPage>(procedurePageQueryKey(shopId, month));
  const summary = query.data?.summary ?? cachedPage?.summary;
  const representatives = query.data?.representatives ?? cachedPage?.representatives ?? (shop ? getMonthlyRepresentatives(shop, month) : []);
  const selectedUser = filter.user ? resolveProcedureUserName(filter.user, representatives) : undefined;
  const dirty = Object.keys(drafts).length > 0;
  const canEdit = actor.role !== "viewer";
  const viewDisabled = dirty || entryDirty || busy || importOpen || deletedOpen || query.isFetching || query.isPlaceholderData;
  const cellsDisabled = busy || entryDirty || query.isPlaceholderData;
  const changeFilter = (next: ProcedureFilter) => {
    if (viewDisabled) return;
    setFilter(next); setCursor(undefined); setPreviousCursors([]); setSelection({}); setError(null);
  };
  const toggleUserSort = () => {
    if (viewDisabled) return;
    setSort(previous => previous === "source" ? "userAsc" : previous === "userAsc" ? "userDesc" : "source");
    setCursor(undefined); setPreviousCursors([]); setSelection({}); setError(null);
  };
  const sortLabel = t(sort === "source" ? "sortUserAscending" : sort === "userAsc" ? "sortUserDescending" : "sortSourceOrder");
  const filterLabel = [filter.product, filter.status ? t(`statuses.${filter.status}`) : undefined, selectedUser ? `${t("user")}: ${selectedUser}` : undefined].filter(Boolean).join(" · ");
  useEffect(() => { if (shop) setSelectedShop(shop); setSelectedDatasetId(month); }, [shop, month, setSelectedShop, setSelectedDatasetId]);
  const columns = useMemo<ColumnDef<ProcedureRecord>[]>(() => COLUMNS.map(({ key, width }) => ({
    accessorKey: key, size: width, header: t(key),
  })), [t]);
  const updateDraft = (record: ProcedureRecord, field: keyof ProcedureFields, value: string) => setDrafts(previous => {
    const draft = previous[record.id] ?? { fields: fieldsOf(record), originalFields: fieldsOf(record), expectedRevision: record.revision };
    const nextValue = field === "user" && value === resolveProcedureUserName(draft.originalFields.user, representatives) ? draft.originalFields.user : value;
    const updated = { ...draft.fields, [field]: nextValue };
    const next = { ...previous };
    if (JSON.stringify(updated) === JSON.stringify(draft.originalFields)) delete next[record.id];
    else next[record.id] = { ...draft, fields: updated };
    return next;
  });
  const table = useReactTable({
    data: query.data?.items ?? emptyProcedureRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: record => record.id,
    manualPagination: true,
  });
  const selectionCount = Object.keys(selection).length;
  const deleteDisabled = viewDisabled;
  const allVisibleSelected = Boolean(query.data?.items.length) && query.data!.items.every(record => selection[record.id] !== undefined);
  const remove = async () => {
    if (!canEdit || busy || dirty || !deleteTargets.length) return;
    setBusy(true); setError(null);
    try {
      const result = await handleDeleteProcedures({ shopId, month, records: deleteTargets });
      if (!result.success) { setError(result.error); setDeleteTargets([]); return; }
      setLastDeletion({ month, records: deleteTargets.map(record => ({ ...record, expectedRevision: record.expectedRevision + 1 })) });
      setDeleteTargets([]); setSelection({}); setCursor(undefined); setPreviousCursors([]);
      await refreshMonth();
    } catch { setError("deleteFailed"); setDeleteTargets([]); } finally { setBusy(false); }
  };
  const undoDelete = async () => {
    if (!lastDeletion || lastDeletion.month !== month || busy || dirty) return;
    setBusy(true); setError(null);
    try {
      const result = await handleRestoreProcedures({ shopId, month, records: lastDeletion.records });
      if (!result.success) { setError(result.error); return; }
      setLastDeletion(null); setSelection({}); setCursor(undefined); setPreviousCursors([]);
      await refreshMonth();
    } catch { setError("restoreFailed"); } finally { setBusy(false); }
  };
  const save = async () => {
    if (!query.data || busy) return;
    const changes = Object.entries(drafts).map(([id, draft]) => ({ id, expectedRevision: draft.expectedRevision, fields: draft.fields }));
    if (changes.some(change => !procedureFieldsSchema.safeParse(change.fields).success)) { setError("invalidData"); return; }
    setBusy(true); setError(null);
    try {
      const result = await handleSaveProcedures({ shopId, month, changes });
      if (!result.success) { setError(result.error); return; }
      const correctedUsers = new Set(Object.values(drafts)
        .filter(draft => selectedUser && resolveProcedureUserName(draft.originalFields.user, representatives) === selectedUser)
        .map(draft => resolveProcedureUserName(procedureFieldsSchema.parse(draft.fields).user, representatives))
        .filter(user => user !== selectedUser));
      if (correctedUsers.size) setFilter(previous => ({ ...previous, user: correctedUsers.size === 1 ? [...correctedUsers][0] : undefined }));
      setDrafts({}); setSelection({});
      if (sort !== "source" || filter.user) { setCursor(undefined); setPreviousCursors([]); }
      await refreshMonth();
    } catch { setError("saveFailed"); } finally { setBusy(false); }
  };
  return <><Header title={`${shop?.name ?? ""} · ${t("title")}`} /><main className="shop-page-content space-y-3">
    <ShopPageToolbar periodSelector={
      <Input aria-label={t("month")} type="month" value={month} className="h-9 w-full" min="2000-01" max="2099-12" disabled={viewDisabled} onChange={event => {
        if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(event.target.value)) return;
        const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Tirane", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
        setMonth(event.target.value); setEntryDate(today.startsWith(event.target.value) ? today : `${event.target.value}-01`); setSort("source"); setFilter({}); setCursor(undefined); setPreviousCursors([]); setSelection({}); setError(null);
        router.replace(`/${locale}/shop/${shopId}/procedures?month=${event.target.value}`, { scroll: false });
      }} />
    }>
        <AppSelect aria-label={t("filterUser")} value={selectedUser ?? ""} disabled={viewDisabled || !summary} className="w-44" onValueChange={value => changeFilter({ ...filter, user: value || undefined })} options={[
          { value: "", label: t("allUsers") },
          ...[...new Set([...(summary?.userTotals ?? []).map(item => resolveProcedureUserName(item.user, representatives)), ...(selectedUser ? [selectedUser] : [])])].sort((left, right) => left.localeCompare(right, locale)).map(user => ({ value: user, label: user })),
        ]} />
        {canEdit && <>
          <Button size="sm" variant="outline" disabled={!query.data || viewDisabled} onClick={() => setImportOpen(true)}><FileSpreadsheet className="mr-1.5 h-4 w-4" />{t("import")}</Button>
          <Button size="sm" variant="outline" disabled={deleteDisabled} onClick={() => setDeletedOpen(true)}><Undo2 className="mr-1.5 h-4 w-4" />{t("deletedRecords")}</Button>
          {lastDeletion?.month === month && <Button size="sm" variant="outline" disabled={deleteDisabled} onClick={() => void undoDelete()}><Undo2 className="mr-1.5 h-4 w-4" />{t("undoDelete", { count: lastDeletion.records.length })}</Button>}
          <Button size="sm" variant="destructive" title={t("selectionHint")} disabled={!selectionCount || deleteDisabled} onClick={() => setDeleteTargets(Object.entries(selection).map(([id, expectedRevision]) => ({ id, expectedRevision })))}><Trash2 className="mr-1.5 h-4 w-4" />{t("deleteSelected", { count: selectionCount })}</Button>
          {selectionCount > 0 && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSelection({})}>{t("clearSelection")}</Button>}
          <Button size="sm" disabled={!dirty || busy} onClick={() => void save()}>{busy ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}{t("save")}</Button>
          <Button size="sm" variant="outline" disabled={!dirty || busy} onClick={() => { setDrafts({}); setError(null); }}><X className="mr-1.5 h-4 w-4" />{t("cancel")}</Button>
        </>}
        <Button size="icon" variant="ghost" className="w-9" aria-label={t("reload")} title={t("reload")} disabled={viewDisabled} onClick={() => void refreshMonth()}><RefreshCw className={`h-4 w-4${query.isFetching ? " animate-spin" : ""}`} /></Button>
    </ShopPageToolbar>
    {(error || query.isError) && <p role="alert" className="text-sm text-destructive">{t(`errors.${error ?? "loadFailed"}`)}</p>}
    {dirty && <p className="text-xs text-amber-700 dark:text-amber-300">{t("unsaved")}</p>}
    {filterLabel && <div className="flex flex-wrap items-center gap-2 text-xs"><span role="status">{t("activeFilter", { filter: filterLabel })}</span><Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={viewDisabled} onClick={() => changeFilter({})}><X className="mr-1 h-3 w-3" />{t("clearFilter")}</Button></div>}
    <div className="flex flex-wrap items-start gap-6">
      {query.isPending ? <p role="status" className="text-sm">{t("loading")}</p> : query.data && <>
      <div className="max-h-[70vh] max-w-full overflow-auto rounded-sm border border-slate-400" style={{ overflowAnchor: "none" }}>
        <table className="border-collapse text-xs" style={{ width: table.getTotalSize() + (canEdit ? 36 : 0) }} aria-label={t("title")} aria-busy={query.isFetching}>
          <thead className="sticky top-0 z-10 bg-white text-black dark:bg-slate-900 dark:text-white">{table.getHeaderGroups().map(group => <tr key={group.id}>{canEdit && <th scope="col" className="w-9 border-b border-r border-slate-400 px-2"><input type="checkbox" aria-label={t("selectPage")} checked={allVisibleSelected} disabled={deleteDisabled || !query.data?.items.length} onChange={event => setSelection(event.target.checked ? Object.fromEntries(query.data!.items.map(record => [record.id, record.revision])) : {})} /></th>}{group.headers.map(header => <th key={header.id} scope="col" aria-sort={header.column.id === "user" ? sort === "userAsc" ? "ascending" : sort === "userDesc" ? "descending" : "none" : undefined} style={{ width: header.getSize() }} className="h-8 border-b border-r border-slate-400 px-2 text-center font-bold">{header.column.id === "user" ? <button type="button" aria-label={sortLabel} title={sortLabel} disabled={viewDisabled} onClick={toggleUserSort} className="inline-flex h-8 w-full items-center justify-center gap-1 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50">{t("user")}{sort === "userAsc" ? <ArrowUp aria-hidden="true" className="h-3 w-3 shrink-0" /> : sort === "userDesc" ? <ArrowDown aria-hidden="true" className="h-3 w-3 shrink-0" /> : <ArrowUpDown aria-hidden="true" className="h-3 w-3 shrink-0" />}</button> : flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}</thead>
          <tbody>{table.getRowModel().rows.map(row => <tr key={row.id} className={drafts[row.id] || selection[row.id] !== undefined ? "bg-amber-50 dark:bg-amber-950/20" : "bg-background"}>{canEdit && <td className="border-b border-r border-slate-400 px-2 text-center"><input type="checkbox" aria-label={t("selectRow", { number: row.index + 1 + previousCursors.length * 50 })} checked={selection[row.id] !== undefined} disabled={deleteDisabled} onChange={event => setSelection(previous => { const next = { ...previous }; if (event.target.checked) next[row.id] = row.original.revision; else delete next[row.id]; return next; })} /></td>}{row.getVisibleCells().map(cell => <td key={cell.id} className="border-b border-r border-slate-400 p-0"><ProcedureCell field={cell.column.id as keyof ProcedureFields} record={row.original} fields={drafts[row.id]?.fields ?? fieldsOf(row.original)} rowNumber={row.index + 1 + previousCursors.length * 50} representatives={representatives} canEdit={canEdit} disabled={cellsDisabled} onChange={(field, value) => updateDraft(row.original, field, value)} /></td>)}</tr>)}</tbody>
        </table>
        {!query.data.items.length && <p className="p-5 text-sm text-muted-foreground">{t(filterLabel ? "emptyFiltered" : "empty")}</p>}
      </div>
      </>}
      <div className="w-full max-w-md shrink-0 space-y-5">
        {summary && <ProcedureSummaryTable summary={summary} filter={{ ...filter, user: selectedUser }} onFilter={changeFilter} filtersDisabled={viewDisabled} />}
        {canEdit && <ProcedureEntry key={`${shopId}:${month}`} shopId={shopId} date={entryDate} representatives={representatives} initiallyExpanded showTableLink={false} disabled={dirty || busy || importOpen || deletedOpen || deleteTargets.length > 0} onDirtyChange={setEntryDirty} onDateChange={setEntryDate} onSaved={() => { setSelection({}); setCursor(undefined); setPreviousCursors([]); setError(null); }} />}
      </div>
    </div>
    {query.data && <div className="flex items-center gap-3"><Button size="sm" variant="outline" disabled={!previousCursors.length || viewDisabled} onClick={() => { setSelection({}); setCursor(previousCursors.at(-1)); setPreviousCursors(previous => previous.slice(0, -1)); }}>{t("previous")}</Button><span className="text-xs">{t("page", { number: previousCursors.length + 1 })}</span><Button size="sm" variant="outline" disabled={!query.data.nextCursor || viewDisabled} onClick={() => { setSelection({}); setPreviousCursors(previous => [...previous, cursor]); setCursor(query.data!.nextCursor!); }}>{t("next")}</Button></div>}
    {importOpen && query.data && <ProcedureImportDialog shopId={shopId} month={month} revision={query.data.summary.revision} onClose={() => setImportOpen(false)} />}
    {deletedOpen && <DeletedProceduresDialog shopId={shopId} month={month} onClose={() => setDeletedOpen(false)} onRestored={() => { setLastDeletion(null); setSelection({}); setCursor(undefined); setPreviousCursors([]); }} />}
    <Dialog open={deleteTargets.length > 0} onOpenChange={open => { if (!open && !busy) setDeleteTargets([]); }}><DialogContent><DialogHeader><DialogTitle>{t("deleteTitle", { count: deleteTargets.length })}</DialogTitle><DialogDescription>{t("deleteDescription", { count: deleteTargets.length, month, shop: shop?.name ?? "" })}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDeleteTargets([])}>{t("cancel")}</Button><Button variant="destructive" disabled={busy} onClick={() => void remove()}>{busy && <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" />}{t("confirmDelete")}</Button></DialogFooter></DialogContent></Dialog>
  </main></>;
}

function ProcedureSummaryTable({ summary, filter = {}, onFilter, filtersDisabled = false }: { summary: ProcedureSummary; filter?: ProcedureFilter; onFilter?: (filter: ProcedureFilter) => void; filtersDisabled?: boolean }) {
  const t = useTranslations("Procedures");
  const completedTryBuy = summary.completed - summary.completedMixMax;
  const products = [
    { label: "MixMax", total: summary.totalMixMax, completed: summary.completedMixMax, pending: summary.pendingMixMax, color: "bg-[#4472c4]" },
    { label: "TRY&BUY", total: summary.totalTryBuy, completed: completedTryBuy, pending: summary.pendingTryBuy, color: "bg-violet-600" },
  ] as const;
  const countCell = (count: number | undefined, next: ProcedureFilter, pending = false) => {
    const clearsAll = !next.product && !next.status;
    const active = Boolean(onFilter) && filter.product === next.product && filter.status === next.status && (!clearsAll || !filter.user);
    const classes = `inline-flex min-h-7 min-w-7 items-center justify-center rounded px-2 tabular-nums ${active ? "bg-primary font-medium text-primary-foreground" : pending && count ? "bg-yellow-100 font-medium text-yellow-950 dark:bg-yellow-950 dark:text-yellow-200" : pending && count === 0 ? "text-muted-foreground" : ""}`;
    if (!onFilter || count === undefined) return <span className={classes}>{count ?? "—"}</span>;
    const nextLabel = [next.product, next.status ? t(`statuses.${next.status}`) : undefined].filter(Boolean).join(" · ");
    const label = clearsAll ? t("showAll") : filter.user ? t("filterCountForUser", { filter: nextLabel, user: filter.user }) : t("filterCount", { count, filter: nextLabel });
    return <button type="button" aria-label={label} title={label} aria-pressed={active} disabled={filtersDisabled} className={`${classes} underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50`} onClick={() => onFilter(clearsAll ? {} : { ...next, ...(filter.user ? { user: filter.user } : {}) })}>{count}</button>;
  };
  return <div className="mt-2 w-full max-w-md shrink-0 overflow-x-auto sm:mt-8">
    <table className="w-full border-collapse text-xs" aria-label={t("summary")}>
      <thead><tr className="border-b text-muted-foreground"><th scope="col" className="px-2 py-2 text-left font-medium">{t("product")}</th><th scope="col" className="px-2 py-2 text-right font-medium">{t("total")}</th>
        {(["completed", "pending", "negative"] as const).map(status => <th key={status} scope="col" className={`px-2 py-2 text-right font-medium ${status === "completed" ? "bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-300" : ""}`}><span className="inline-flex items-center justify-end gap-1"><span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${status === "completed" ? "bg-green-600" : status === "pending" ? "bg-yellow-500" : "bg-red-500"}`} />{t(status === "completed" ? "summaryCompleted" : status)}</span></th>)}
      </tr></thead>
      <tbody>{products.map(product => <tr key={product.label} className="border-b"><th scope="row" className="whitespace-nowrap px-2 py-2.5 text-left font-medium"><span aria-hidden="true" className={`mr-1.5 inline-block h-2 w-2 rounded-full ${product.color}`} />{product.label}</th><td className="px-2 py-2.5 text-right">{countCell(product.total, { product: product.label })}</td><td className="bg-green-50 px-2 py-2.5 text-right dark:bg-green-950/30">{countCell(product.completed, { product: product.label, status: "completed" })}</td><td className="px-2 py-2.5 text-right">{countCell(product.pending, { product: product.label, status: "pending" }, true)}</td><td className="px-2 py-2.5 text-right">{countCell(product.total !== undefined && product.pending !== undefined ? product.total - product.completed - product.pending : undefined, { product: product.label, status: "negative" })}</td></tr>)}</tbody>
      <tfoot><tr className="bg-muted/50 font-medium"><th scope="row" className="px-2 py-2 text-left">{t("total")}</th><td className="px-2 py-2 text-right">{countCell(summary.total, {})}</td><td className="bg-green-100/60 px-2 py-2 text-right dark:bg-green-950/40">{countCell(summary.completed, { status: "completed" })}</td><td className="px-2 py-2 text-right">{countCell(summary.pending, { status: "pending" })}</td><td className="px-2 py-2 text-right">{countCell(summary.negative, { status: "negative" })}</td></tr></tfoot>
    </table>
  </div>;
}

function ProcedureImportDialog({ shopId, month, revision, onClose }: { shopId: string; month: string; revision: number; onClose: () => void }) {
  const t = useTranslations("Procedures");
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [expectedRevision] = useState(revision);
  const [correctDates, setCorrectDates] = useState(true);
  const [preview, setPreview] = useState<{ summary: ProcedureSummary; correctedDates: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (mode: "preview" | "import") => {
    if (!file || busy) return;
    setBusy(true); setError(null);
    try {
      const form = new FormData(); form.set("file", file); form.set("mode", mode);
      form.set("input", JSON.stringify({ month, correctReversedDates: correctDates, expectedRevision }));
      const response = await fetch(`/api/shops/${encodeURIComponent(shopId)}/procedures-import`, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) { setError(result.error ?? "importFailed"); return; }
      if (mode === "preview") setPreview({ summary: procedureSummarySchema.parse(result.summary), correctedDates: result.correctedDates });
      else {
        await Promise.all([
          client.invalidateQueries({ queryKey: proceduresQueryKey(shopId, month) }),
          client.invalidateQueries({ queryKey: dailyActivityMonthQueryKey(shopId, month) }),
        ]);
        onClose();
      }
    } catch { setError("importFailed"); } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent><DialogHeader><DialogTitle>{t("import")}</DialogTitle><DialogDescription>{t("importHint", { month })}</DialogDescription></DialogHeader>
    <Input type="file" accept=".xlsx" aria-label={t("chooseFile")} disabled={busy} onChange={event => { setFile(event.target.files?.[0] ?? null); setPreview(null); setError(null); }} />
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={correctDates} disabled={busy} onChange={event => { setCorrectDates(event.target.checked); setPreview(null); }} />{t("correctDates")}</label>
    {preview && <><ProcedureSummaryTable summary={preview.summary} /><p className="text-sm">{t("importReview", { count: preview.summary.total, corrected: preview.correctedDates })}</p></>}
    {error && <p role="alert" className="text-sm text-destructive">{t(`errors.${error}`)}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{t("cancel")}</Button><Button disabled={!file || busy} onClick={() => void submit(preview ? "import" : "preview")}>{busy && <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" />}{t(preview ? "confirmImport" : "preview")}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
